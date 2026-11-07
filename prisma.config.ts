import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` (run by `npm ci` through postinstall) and `prisma validate` do not
// connect to a database, so a fresh checkout must not need DIRECT_URL. Commands that do
// connect (`migrate deploy`, `studio`) fail with Prisma's own missing-URL error instead.
const directUrl = process.env.DIRECT_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Prisma CLI commands use the direct/session-pooler connection only.
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
