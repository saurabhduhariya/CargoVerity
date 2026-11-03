import "dotenv/config";
import { Client } from "pg";

const users = [
  {
    id: process.env.SEED_EXECUTIVE_ID,
    email: process.env.SEED_EXECUTIVE_EMAIL,
    fullName: process.env.SEED_EXECUTIVE_NAME || "Synthetic Executive",
    role: "EXECUTIVE",
  },
  {
    id: process.env.SEED_MANAGER_ID,
    email: process.env.SEED_MANAGER_EMAIL,
    fullName: process.env.SEED_MANAGER_NAME || "Synthetic Manager",
    role: "MANAGER",
  },
];

for (const user of users) {
  if (!user.id || !user.email) {
    throw new Error("Set both SEED_EXECUTIVE_ID/EMAIL and SEED_MANAGER_ID/EMAIL to existing Supabase Auth user values.");
  }
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  for (const user of users) {
    await client.query(
      `INSERT INTO "User" ("id", "email", "fullName", "role", "createdAt", "updatedAt")
       VALUES ($1::uuid, $2, $3, $4::"UserRole", NOW(), NOW())
       ON CONFLICT ("id") DO UPDATE
       SET "email" = EXCLUDED."email", "fullName" = EXCLUDED."fullName", "role" = EXCLUDED."role", "updatedAt" = NOW()` ,
      [user.id, user.email, user.fullName, user.role],
    );
  }
  console.log("Seeded the Executive and Manager application roles for the supplied Auth user IDs.");
} finally {
  await client.end();
}
