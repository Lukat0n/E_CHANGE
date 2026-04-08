import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const config: { url: string; authToken?: string } = {
    url: process.env.DATABASE_URL || "file:./prisma/dev.db",
  };

  // Turso auth token for production
  if (process.env.TURSO_AUTH_TOKEN) {
    config.authToken = process.env.TURSO_AUTH_TOKEN;
  }

  const adapter = new PrismaLibSql(config);
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
