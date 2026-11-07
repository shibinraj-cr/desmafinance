import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const findFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { leadPulseSource: { findUnique: (a: unknown) => findUnique(a), findFirst: (a: unknown) => findFirst(a) } },
}));

import { resolveWaInboundSourceId, WA_INBOUND_SOURCE_CODE, WA_INBOUND_SOURCE_LABEL } from "@/lib/wa/mirror";

beforeEach(() => {
  findUnique.mockReset();
  findFirst.mockReset();
});

describe("resolveWaInboundSourceId", () => {
  it("is the Wabis source, now labelled WA API", () => {
    expect(WA_INBOUND_SOURCE_CODE).toBe("wabis");
    expect(WA_INBOUND_SOURCE_LABEL).toBe("WA API");
  });

  it("finds the source by code first", async () => {
    findUnique.mockResolvedValue({ id: "src_wabis" });
    await expect(resolveWaInboundSourceId()).resolves.toBe("src_wabis");
    expect(findUnique).toHaveBeenCalledWith({ where: { code: "wabis" }, select: { id: true } });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("falls back to a hand-made source named WA API or Wabis", async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue({ id: "src_by_hand" });
    await expect(resolveWaInboundSourceId()).resolves.toBe("src_by_hand");
    const where = findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { label: { equals: "WA API", mode: "insensitive" } },
      { label: { equals: "Wabis", mode: "insensitive" } },
    ]);
  });

  it("returns null when there is no such source", async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
    await expect(resolveWaInboundSourceId()).resolves.toBeNull();
  });
});
