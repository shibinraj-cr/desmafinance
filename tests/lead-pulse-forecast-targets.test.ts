import { describe, it, expect, vi } from "vitest";

// lead-pulse-metrics builds the prisma client at import; the helper under test is pure.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { sumDistinctTargets } from "@/lib/lead-pulse-metrics";

describe("sumDistinctTargets", () => {
  it("counts a group target once, however many of its services have rows", () => {
    // Group target 10 shared by three services, plus a service-level target of 4.
    const rows = [
      { key: "g:nursing", target: 10 },
      { key: "g:nursing", target: 10 },
      { key: "g:nursing", target: 10 },
      { key: "s:osce", target: 4 },
    ];
    expect(sumDistinctTargets(rows)).toBe(14);
  });

  it("is zero with no rows", () => {
    expect(sumDistinctTargets([])).toBe(0);
  });
});
