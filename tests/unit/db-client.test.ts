import { afterEach, describe, expect, it, vi } from "vitest";

const { adapterCreated, clientCreated } = vi.hoisted(() => ({
  adapterCreated: vi.fn(),
  clientCreated: vi.fn(),
}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class { constructor(options: unknown) { adapterCreated(options); } } }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: class { constructor(options: unknown) { clientCreated(options); } } }));
vi.mock("@/lib/env", () => ({ requireDatabaseUrl: () => "postgresql://synthetic.test/cargoverity" }));

describe("database client lifecycle", () => {
  afterEach(() => {
    delete (globalThis as { prisma?: unknown }).prisma;
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each(["production", "development"])("reuses one client and adapter in %s across calls and module reloads", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("DIRECT_URL", "");
    const { getPrisma } = await import("@/lib/db");
    const first = getPrisma();
    expect(getPrisma()).toBe(first);
    vi.resetModules();
    expect((await import("@/lib/db")).getPrisma()).toBe(first);
    expect(adapterCreated).toHaveBeenCalledExactlyOnceWith({ connectionString: "postgresql://synthetic.test/cargoverity" });
    expect(clientCreated).toHaveBeenCalledTimes(1);
  });
});
