import { describe, expect, it } from "vitest";

import { nextUncertainFieldId } from "@/features/review/next-uncertain";

describe("nextUncertainFieldId (Week 4 Step 6)", () => {
  it("advances after the current field and wraps after the last", () => {
    const ids = ["A", "B", "C"];
    expect(nextUncertainFieldId(ids, "A")).toBe("B");
    expect(nextUncertainFieldId(ids, "B")).toBe("C");
    expect(nextUncertainFieldId(ids, "C")).toBe("A");
  });

  it("starts at the first uncertain field when nothing (or a resolved field) is focused", () => {
    expect(nextUncertainFieldId(["A", "B"], null)).toBe("A");
    expect(nextUncertainFieldId(["A", "B"], undefined)).toBe("A");
    expect(nextUncertainFieldId(["A", "B"], "Z")).toBe("A");
  });

  it("returns null when there are no uncertain fields and stays on a single one", () => {
    expect(nextUncertainFieldId([], "A")).toBeNull();
    expect(nextUncertainFieldId(["A"], "A")).toBe("A");
  });
});
