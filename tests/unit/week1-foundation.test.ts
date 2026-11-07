import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { parseSeedUsers } from "../../scripts/seed-demo-users.mjs";
import { createShipment, createShipmentSchema } from "@/lib/shipment-service";

/**
 * Week 1 Steps 1 and 5: baseline configuration contracts, the controlled role seed and the
 * shipment creation service.
 */

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const validSeedEnv = {
  SEED_EXECUTIVE_ID: "11111111-1111-4111-8111-111111111111",
  SEED_EXECUTIVE_EMAIL: "Exec@Example.test",
  SEED_MANAGER_ID: "22222222-2222-4222-8222-222222222222",
  SEED_MANAGER_EMAIL: "manager@example.test",
};

describe("project baseline", () => {
  it("pins Node 24 consistently for local, CI and Docker", () => {
    const nvmrc = read(".nvmrc").trim();
    expect(nvmrc).toMatch(/^24\.\d+\.\d+$/);
    expect(read(".node-version").trim()).toBe(nvmrc);
    expect(read("Dockerfile")).toContain(`FROM node:${nvmrc}-`);
    expect(read(".github/workflows/ci.yml")).toContain('node-version-file: ".nvmrc"');
    expect(JSON.parse(read("package.json")).engines.node).toBe(">=24.0.0 <25.0.0");
  });

  it("defines the required npm scripts", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    for (const name of ["dev", "build", "start", "lint", "typecheck", "test", "test:e2e", "db:seed"]) {
      expect(scripts[name], name).toBeTruthy();
    }
  });

  it("keeps secrets out of Git and Docker build contexts", () => {
    const gitignore = read(".gitignore").split("\n");
    expect(gitignore).toEqual(expect.arrayContaining([".env", ".env.*", "!.env.example"]));
    expect(read(".dockerignore").split("\n")).toEqual(expect.arrayContaining([".env*", ".git"]));
  });

  it("documents every server environment variable in .env.example without values for secrets", () => {
    const example = read(".env.example");
    const envSource = read("src/lib/env.ts");
    const schemaKeys = [...envSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]);

    expect(schemaKeys.length).toBeGreaterThan(10);
    for (const key of schemaKeys.filter((key) => key !== "NODE_ENV")) {
      expect(example, key).toMatch(new RegExp(`^#?\\s?${key}=`, "m"));
    }
    for (const secret of ["SUPABASE_SECRET_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "DATABASE_URL", "DIRECT_URL"]) {
      expect(example).toMatch(new RegExp(`^${secret}=$`, "m"));
    }
  });

  it("does not require DIRECT_URL just to install or generate the Prisma client", () => {
    const config = read("prisma.config.ts");
    expect(config).not.toMatch(/env\(\s*["']DIRECT_URL["']\s*\)/);
    expect(config).toContain("process.env.DIRECT_URL");
  });
});

describe("controlled role seed", () => {
  it("parses valid Executive and Manager seed values and normalizes emails", () => {
    const users = parseSeedUsers(validSeedEnv);
    expect(users.map((user: { role: string }) => user.role)).toEqual(["EXECUTIVE", "MANAGER"]);
    expect(users[0].email).toBe("exec@example.test");
    expect(users[0].fullName).toBe("Synthetic Executive");
  });

  it("rejects missing values, non-UUID IDs and invalid emails", () => {
    expect(() => parseSeedUsers({})).toThrow(/SEED_EXECUTIVE_ID and SEED_EXECUTIVE_EMAIL are required/);
    expect(() => parseSeedUsers({ ...validSeedEnv, SEED_MANAGER_ID: "42" })).toThrow(/SEED_MANAGER_ID must be/);
    expect(() => parseSeedUsers({ ...validSeedEnv, SEED_EXECUTIVE_EMAIL: "not-an-email" })).toThrow(
      /SEED_EXECUTIVE_EMAIL is not a valid/,
    );
  });

  it("refuses to give both roles to the same account", () => {
    expect(() =>
      parseSeedUsers({ ...validSeedEnv, SEED_MANAGER_ID: validSeedEnv.SEED_EXECUTIVE_ID }),
    ).toThrow(/different Auth users/);
    expect(() =>
      parseSeedUsers({ ...validSeedEnv, SEED_MANAGER_EMAIL: "exec@example.test" }),
    ).toThrow(/different email/);
  });
});

describe("shipment creation service", () => {
  function fakePrisma() {
    const tx = {
      supplier: { upsert: vi.fn().mockResolvedValue({ id: "sup-1", name: "Acme Ltd" }) },
      shipment: { create: vi.fn().mockImplementation(async (args) => ({ id: "shp-1", ...args.data })) },
    };
    return {
      tx,
      prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
    };
  }

  it("validates the reference before touching the database", async () => {
    const { prisma } = fakePrisma();
    await expect(
      createShipment(prisma as never, { id: "u1", role: "EXECUTIVE" }, { reference: " x " }),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(createShipmentSchema.safeParse({ reference: "a".repeat(81) }).success).toBe(false);
  });

  it("creates the shipment for the actor, reuses suppliers by normalized key and audits creation", async () => {
    const { prisma, tx } = fakePrisma();

    await createShipment(
      prisma as never,
      { id: "u1", role: "EXECUTIVE" },
      { reference: "  SHP-1001 ", supplierName: "  ACME   Ltd " },
    );

    expect(tx.supplier.upsert).toHaveBeenCalledWith({
      where: { normalizedName: "acme ltd" },
      update: {},
      create: { name: "ACME Ltd", normalizedName: "acme ltd" },
    });
    const data = tx.shipment.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      reference: "SHP-1001",
      createdById: "u1",
      supplierId: "sup-1",
      auditEvents: { create: { actorId: "u1", action: "SHIPMENT_CREATED", entityType: "Shipment" } },
    });
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("currentRevision");
  });

  it("ignores client-supplied ownership, status and revision fields", async () => {
    const { prisma, tx } = fakePrisma();

    await createShipment(
      prisma as never,
      { id: "u1", role: "EXECUTIVE" },
      { reference: "SHP-1002", createdById: "someone-else", status: "APPROVED", currentRevision: 9 },
    );

    const data = tx.shipment.create.mock.calls[0][0].data;
    expect(data.createdById).toBe("u1");
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("currentRevision");
    expect(tx.supplier.upsert).not.toHaveBeenCalled();
  });
});
