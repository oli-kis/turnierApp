import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireAdmin } from "../plugins/auth.js";
import {
  getCategoryOr404,
  getGroupOr404,
  getTeamOr404,
  getTournamentOr404,
  scheduleExists,
} from "../lib/loaders.js";

const idParam = z.object({ id: z.string() });

/** qualifiersPerGroup values that yield a legal bracket (4/8/16) for a group count. */
function bracketOptions(groupCount: number): number[] {
  if (groupCount <= 0) return [];
  const opts: number[] = [];
  for (const N of [4, 8, 16]) {
    if (N % groupCount === 0) opts.push(N / groupCount);
  }
  return opts;
}

/** Enforce groups × qualifiersPerGroup ∈ {4,8,16} (twice: on set, and on group changes). */
function assertBracketValid(groupCount: number, qualifiersPerGroup: number | null | undefined) {
  if (qualifiersPerGroup == null) return;
  const total = groupCount * qualifiersPerGroup;
  if (![4, 8, 16].includes(total)) {
    const opts = bracketOptions(groupCount);
    throw Errors.unprocessable(
      "INVALID_BRACKET_SIZE",
      `groups(${groupCount}) × qualifiersPerGroup(${qualifiersPerGroup}) = ${total}, must be 4, 8 or 16. ` +
        `Valid qualifiersPerGroup for ${groupCount} group(s): ${opts.length ? opts.join(", ") : "none"}`,
    );
  }
}

async function assertNoSchedule(tournamentId: string) {
  if (await scheduleExists(tournamentId)) {
    throw Errors.conflict(
      "SCHEDULE_EXISTS",
      "A schedule already exists; regenerate after structural changes",
    );
  }
}

export async function structureRoutes(app: FastifyInstance): Promise<void> {
  // ---- Categories ----
  app.post("/tournaments/:id/categories", async (request, reply) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        name: z.string().min(1),
        qualifiersPerGroup: z.number().int().positive().nullish(),
      })
      .parse(request.body);
    await getTournamentOr404(id);
    await assertNoSchedule(id);
    const category = await prisma.category.create({
      data: {
        tournamentId: id,
        name: body.name,
        qualifiersPerGroup: body.qualifiersPerGroup ?? null,
      },
    });
    return reply.status(201).send({ category });
  });

  app.patch("/categories/:id", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        qualifiersPerGroup: z.number().int().positive().nullable().optional(),
      })
      .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" })
      .parse(request.body);

    const category = await prisma.category.findUnique({
      where: { id },
      include: { groups: { include: { teams: true } } },
    });
    if (!category) throw Errors.notFound("Category");

    if (body.qualifiersPerGroup !== undefined) {
      if (category.knockoutGenerated) {
        throw Errors.conflict(
          "KNOCKOUT_LOCKED",
          "qualifiersPerGroup is locked once the knockout is generated",
        );
      }
      if (body.qualifiersPerGroup !== null) {
        assertBracketValid(category.groups.length, body.qualifiersPerGroup);
        const smallest = Math.min(
          ...category.groups.map((g) => g.teams.length).filter((n) => n > 0),
        );
        if (Number.isFinite(smallest) && body.qualifiersPerGroup >= smallest) {
          throw Errors.unprocessable(
            "INVALID_BRACKET_SIZE",
            `qualifiersPerGroup must be smaller than the smallest group (${smallest})`,
          );
        }
      }
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.qualifiersPerGroup !== undefined
          ? { qualifiersPerGroup: body.qualifiersPerGroup }
          : {}),
      },
    });
    return { category: updated };
  });

  app.delete("/categories/:id", async (request, reply) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const category = await getCategoryOr404(id);
    await assertNoSchedule(category.tournamentId);
    await prisma.category.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ---- Groups ----
  app.post("/categories/:id/groups", async (request, reply) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const body = z.object({ name: z.string().min(1) }).parse(request.body);
    const category = await prisma.category.findUnique({
      where: { id },
      include: { groups: true },
    });
    if (!category) throw Errors.notFound("Category");
    await assertNoSchedule(category.tournamentId);
    // Adding a group re-runs the bracket check against the prospective count.
    assertBracketValid(category.groups.length + 1, category.qualifiersPerGroup);

    const group = await prisma.group.create({
      data: { categoryId: id, name: body.name },
    });
    return reply.status(201).send({ group });
  });

  app.patch("/groups/:id", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const body = z.object({ name: z.string().min(1) }).parse(request.body);
    await getGroupOr404(id);
    const updated = await prisma.group.update({ where: { id }, data: { name: body.name } });
    return { group: updated };
  });

  app.delete("/groups/:id", async (request, reply) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const group = await prisma.group.findUnique({
      where: { id },
      include: { category: { include: { groups: true } } },
    });
    if (!group) throw Errors.notFound("Group");
    await assertNoSchedule(group.category.tournamentId);
    // Removing a group re-runs the bracket check against the prospective count.
    assertBracketValid(group.category.groups.length - 1, group.category.qualifiersPerGroup);
    await prisma.group.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ---- Teams ----
  app.post("/groups/:id/teams", async (request, reply) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const body = z.object({ name: z.string().min(1) }).parse(request.body);
    const group = await prisma.group.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!group) throw Errors.notFound("Group");
    await assertNoSchedule(group.category.tournamentId);
    const team = await prisma.team.create({
      data: { categoryId: group.categoryId, groupId: id, name: body.name },
    });
    return reply.status(201).send({ team });
  });

  app.patch("/teams/:id", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ name: z.string().min(1).optional(), groupId: z.string().optional() })
      .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" })
      .parse(request.body);
    const team = await prisma.team.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!team) throw Errors.notFound("Team");

    // Renames are always allowed; moving a team is a structural change.
    if (body.groupId !== undefined) {
      await assertNoSchedule(team.category.tournamentId);
      const target = await prisma.group.findUnique({ where: { id: body.groupId } });
      if (!target || target.categoryId !== team.categoryId) {
        throw Errors.badRequest("Target group must belong to the same category");
      }
    }

    const updated = await prisma.team.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.groupId !== undefined ? { groupId: body.groupId } : {}),
      },
    });
    return { team: updated };
  });

  app.delete("/teams/:id", async (request, reply) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const team = await prisma.team.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!team) throw Errors.notFound("Team");
    await assertNoSchedule(team.category.tournamentId);
    await prisma.team.delete({ where: { id } });
    return reply.status(204).send();
  });
}
