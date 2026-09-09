import { describe, it, expect, beforeAll } from "vitest";
import { mintCareersToken, verifyCareersToken } from "@/lib/hiring/careers-token";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-careers-tokens";
});

const NOW = 1_760_000_000_000;

describe("careers parse token", () => {
  it("accepts a fresh token for its own slug", () => {
    const t = mintCareersToken("academic-counsellor", NOW);
    expect(verifyCareersToken(t, "academic-counsellor", NOW + 1000)).toEqual({ ok: true });
  });

  /** A token minted for one job must not buy parses against another. */
  it("refuses a token minted for a different job", () => {
    const t = mintCareersToken("academic-counsellor", NOW);
    expect(verifyCareersToken(t, "documentation-executive", NOW + 1000)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("expires after its window", () => {
    const t = mintCareersToken("a-job", NOW);
    expect(verifyCareersToken(t, "a-job", NOW + 31 * 60_000)).toEqual({ ok: false, reason: "expired" });
  });

  /**
   * The expiry sits inside the signed payload, so pushing it out must break the
   * signature rather than extending the token.
   */
  it("refuses a token whose expiry was edited", () => {
    const t = mintCareersToken("a-job", NOW);
    const [slug, , mac] = t!.split(".");
    const forged = `${slug}.${NOW + 10 * 24 * 3600_000}.${mac}`;
    expect(verifyCareersToken(forged, "a-job", NOW).ok).toBe(false);
  });

  it("refuses missing and malformed tokens without throwing", () => {
    expect(verifyCareersToken(null, "a-job", NOW)).toEqual({ ok: false, reason: "missing" });
    expect(verifyCareersToken("", "a-job", NOW)).toEqual({ ok: false, reason: "missing" });
    expect(verifyCareersToken("nonsense", "a-job", NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCareersToken("a.b", "a-job", NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  /**
   * Minting happens while rendering the PUBLIC job page. Throwing there would
   * take down the advertised job ad because a convenience could not be signed.
   */
  it("returns null instead of throwing when there is no secret", () => {
    const saved = process.env.NEXTAUTH_SECRET;
    const savedAuth = process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      expect(mintCareersToken("a-job", NOW)).toBeNull();
      // And nothing verifies, so the endpoint refuses rather than opening up.
      expect(verifyCareersToken("anything.123.abc", "a-job", NOW).ok).toBe(false);
    } finally {
      if (saved) process.env.NEXTAUTH_SECRET = saved;
      if (savedAuth) process.env.AUTH_SECRET = savedAuth;
    }
  });

  /** timingSafeEqual throws on unequal lengths — that must not reach the route. */
  it("survives a signature of the wrong length", () => {
    const t = mintCareersToken("a-job", NOW);
    const [slug, exp] = t!.split(".");
    expect(verifyCareersToken(`${slug}.${exp}.short`, "a-job", NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});
