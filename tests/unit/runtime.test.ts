import { describe, expect, it } from "vitest";

describe("runtime baseline", () => {
  it("runs on the Node 24 runtime contract", () => {
    const majorVersion = Number(process.versions.node.split(".")[0]);

    expect(majorVersion).toBeGreaterThanOrEqual(24);
    expect(majorVersion).toBeLessThan(25);
  });
});
