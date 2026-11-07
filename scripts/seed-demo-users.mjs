import "dotenv/config";

import { pathToFileURL } from "node:url";

/**
 * Controlled role seed (Week 1 Step 5.9).
 *
 * Application roles are granted only here, never by the browser or by self sign-up.
 * The Auth users must already exist in Supabase Auth (create them in the Supabase dashboard).
 * When SUPABASE_SECRET_KEY is set, each ID is checked against Supabase Auth and its email must
 * match, so a typo cannot grant a role to the wrong account.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseSeedUsers(env) {
  const users = [
    {
      id: env.SEED_EXECUTIVE_ID?.trim(),
      email: env.SEED_EXECUTIVE_EMAIL?.trim().toLowerCase(),
      fullName: env.SEED_EXECUTIVE_NAME?.trim() || "Synthetic Executive",
      role: "EXECUTIVE",
    },
    {
      id: env.SEED_MANAGER_ID?.trim(),
      email: env.SEED_MANAGER_EMAIL?.trim().toLowerCase(),
      fullName: env.SEED_MANAGER_NAME?.trim() || "Synthetic Manager",
      role: "MANAGER",
    },
  ];

  const errors = [];
  for (const user of users) {
    const prefix = `SEED_${user.role}`;
    if (!user.id || !user.email) {
      errors.push(`${prefix}_ID and ${prefix}_EMAIL are required.`);
      continue;
    }
    if (!UUID_PATTERN.test(user.id)) errors.push(`${prefix}_ID must be a Supabase Auth user UUID.`);
    if (!EMAIL_PATTERN.test(user.email)) errors.push(`${prefix}_EMAIL is not a valid email address.`);
  }

  if (errors.length === 0) {
    if (users[0].id.toLowerCase() === users[1].id.toLowerCase()) {
      errors.push("The Executive and Manager must be different Auth users (role separation).");
    }
    if (users[0].email === users[1].email) {
      errors.push("The Executive and Manager must use different email addresses.");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid seed configuration:\n- ${errors.join("\n- ")}`);
  }

  return users;
}

async function verifyAuthUsers(users, env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !secretKey) {
    console.warn("SUPABASE_SECRET_KEY not set: skipping the Supabase Auth existence check.");
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const user of users) {
    const { data, error } = await admin.auth.admin.getUserById(user.id);
    if (error || !data?.user) {
      throw new Error(`No Supabase Auth user exists for SEED_${user.role}_ID.`);
    }
    if (data.user.email?.toLowerCase() !== user.email) {
      throw new Error(`SEED_${user.role}_EMAIL does not match the Supabase Auth user's email.`);
    }
  }
}

async function main() {
  const users = parseSeedUsers(process.env);
  await verifyAuthUsers(users, process.env);

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  });
  await client.connect();

  try {
    for (const user of users) {
      await client.query(
        `INSERT INTO "User" ("id", "email", "fullName", "role", "createdAt", "updatedAt")
         VALUES ($1::uuid, $2, $3, $4::"UserRole", NOW(), NOW())
         ON CONFLICT ("id") DO UPDATE
         SET "email" = EXCLUDED."email", "fullName" = EXCLUDED."fullName", "role" = EXCLUDED."role", "updatedAt" = NOW()`,
        [user.id, user.email, user.fullName, user.role],
      );
    }
    console.log("Seeded the Executive and Manager application roles for the supplied Auth user IDs.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Seed failed.");
    process.exit(1);
  });
}
