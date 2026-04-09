import { PrismaClient } from "@prisma/client";
import { existsSync, copyFileSync } from "fs";
import { join } from "path";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function getDbUrl(): string | undefined {
  // On Vercel, the build dir is read-only. Copy DB to /tmp for writes.
  if (process.env.VERCEL) {
    const srcDb = join(process.cwd(), "prisma", "dev.db");
    const tmpDb = "/tmp/dev.db";
    if (!existsSync(tmpDb) && existsSync(srcDb)) {
      copyFileSync(srcDb, tmpDb);
    }
    return "file:/tmp/dev.db";
  }
  return undefined;
}

const dbUrl = getDbUrl();

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasources: dbUrl ? { db: { url: dbUrl } } : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
