import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { AppError, Errors } from "../lib/errors.js";
import { requireAuth } from "../plugins/auth.js";
import { broadcaster } from "../sse/broadcaster.js";

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const strictLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

function publicUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Referee self-registration -> PENDING.
  app.post("/auth/register", strictLimit, async (request, reply) => {
    const { email, name, password } = registerSchema.parse(request.body);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw Errors.conflict("EMAIL_TAKEN", "Email already registered");

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, name, passwordHash, role: "REFEREE", status: "PENDING" },
    });
    // Notify any live admin dashboards; id only, no personal data on the stream.
    broadcaster.broadcastAll("referee.registered", { refereeId: user.id });
    return reply.status(201).send({ user: publicUser(user) });
  });

  app.post("/auth/login", strictLimit, async (request) => {
    const { email, password } = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw Errors.unauthorized("Invalid credentials");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw Errors.unauthorized("Invalid credentials");

    // Non-approved referees cannot log in; distinct codes per state.
    if (user.role === "REFEREE" && user.status === "PENDING") {
      throw new AppError(
        "REFEREE_PENDING",
        403,
        "Your referee account is awaiting admin approval",
      );
    }
    if (user.role === "REFEREE" && user.status === "REJECTED") {
      throw new AppError("REFEREE_REJECTED", 403, "Your referee registration was rejected");
    }

    const token = app.jwt.sign({ userId: user.id, role: user.role as "ADMIN" | "REFEREE" });
    return { token, user: publicUser(user) };
  });

  app.get("/auth/me", async (request) => {
    const auth = await requireAuth(request);
    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw Errors.notFound("User");
    return { user: publicUser(user) };
  });
}
