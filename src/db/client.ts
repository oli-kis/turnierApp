import { PrismaClient } from "@prisma/client";

// Single Prisma client for the process. One tournament weekend, one server.
export const prisma = new PrismaClient();
