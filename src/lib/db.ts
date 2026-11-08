import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

import { requireDatabaseUrl } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrisma() {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString = process.env.DIRECT_URL || requireDatabaseUrl();

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });

  // Reuse the pool in production too; a new client per request exhausts session-mode limits.
  globalForPrisma.prisma = client;

  return client;
}
