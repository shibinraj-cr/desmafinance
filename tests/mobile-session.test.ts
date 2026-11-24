import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test/test";
  process.env.NEXTAUTH_SECRET = "mobile-session-test-secret-0123456789abcdef";
  return {
    authorization: null as string | null,
    webSession: null as { user: { id: string } } | null,
    user: null as Record<string, unknown> | null,
    update: vi.fn(),
    updateMany: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ headers: () => new Headers(h.authorization ? { authorization: h.authorization } : {}) }));
vi.mock("next-auth", () => ({ getServerSession: async () => h.webSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async () => h.user,
      update: (...a: unknown[]) => h.update(...a),
      updateMany: (...a: unknown[]) => h.updateMany(...a),
    },
  },
}));

import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";
import { cleanDeviceLabel, isCurrentMobileSession, readAppToken } from "@/lib/mobile-session";
import { getCurrentUserAndPermissions, getCurrentUserPermissions } from "@/lib/permissions";
import { GET as sessionGET, DELETE as sessionDELETE } from "@/app/api/auth/mobile-session/route";
import { POST as login } from "@/app/api/auth/mobile-login/route";

const SECRET = process.env.NEXTAUTH_SECRET!;
const bearer = async (claims: { uid: string; sid?: string }, maxAge = 3600) =>
  `Bearer ${await encode({ token: { role: "executive", ...claims }, secret: SECRET, maxAge })}`;
const req = (method: string, authorization?: string) =>
  new Request("http://x/api/auth/mobile-session", { method, headers: authorization ? { authorization } : {} });

function dbUser(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    isActive: true,
    role: "executive",
    roleRef: { isAdmin: false, canApprove: false, needsApproval: false, pages: ["/crm/leads"], name: "Sales Consultant" },
    leadPulseRole: null,
    pcEnrollGrant: null,
    draftFirst: false,
    mobileSessionId: "sid-current",
    mobileSessionAt: new Date("2026-11-17T09:00:00Z"),
    mobileSessionDevice: "samsung SM-A546E",
    ...over,
  };
}

beforeEach(() => {
  h.authorization = null;
  h.webSession = null;
  h.user = dbUser();
  h.update.mockReset();
  h.updateMany.mockReset();
});

describe("isCurrentMobileSession", () => {
  it("accepts only the user's current session id", () => {
    expect(isCurrentMobileSession("a", "a")).toBe(true);
    expect(isCurrentMobileSession("b", "a")).toBe(false);
    expect(isCurrentMobileSession(null, "a")).toBe(false);
  });

  it("lets a token from before single-session through until the next app sign-in", () => {
    expect(isCurrentMobileSession(null, null)).toBe(true);
    expect(isCurrentMobileSession("a", null)).toBe(false);
  });
});

describe("cleanDeviceLabel", () => {
  it("trims, strips control characters and caps the length", () => {
    expect(cleanDeviceLabel("  Google Pixel 8\n")).toBe("Google Pixel 8");
    expect(cleanDeviceLabel("x".repeat(200))).toHaveLength(80);
    expect(cleanDeviceLabel("  ")).toBeNull();
    expect(cleanDeviceLabel(42)).toBeNull();
    expect(cleanDeviceLabel(undefined)).toBeNull();
  });
});

describe("readAppToken", () => {
  it("reads uid and sid from an app token", async () => {
    expect(await readAppToken(await bearer({ uid: "u1", sid: "s1" }))).toEqual({ uid: "u1", sid: "s1" });
    expect(await readAppToken(await bearer({ uid: "u1" }))).toEqual({ uid: "u1", sid: null });
  });

  it("rejects missing, malformed, foreign and expired tokens", async () => {
    expect(await readAppToken(null)).toBeNull();
    expect(await readAppToken("Basic abc")).toBeNull();
    expect(await readAppToken("Bearer not-a-jwt")).toBeNull();
    const foreign = await encode({ token: { uid: "u1", role: "executive" }, secret: "another-secret-0123456789abcdefghijkl" });
    expect(await readAppToken(`Bearer ${foreign}`)).toBeNull();
    expect(await readAppToken(await bearer({ uid: "u1", sid: "s1" }, -60))).toBeNull();
  });
});

describe("permissions with an app token", () => {
  it("accepts the current app session", async () => {
    h.authorization = await bearer({ uid: "u1", sid: "sid-current" });
    const r = await getCurrentUserAndPermissions();
    expect(r.userId).toBe("u1");
    expect(r.perms?.pages).toContain("/crm/leads");
    expect(await getCurrentUserPermissions()).not.toBeNull();
  });

  it("refuses a token replaced by a newer app sign-in", async () => {
    h.authorization = await bearer({ uid: "u1", sid: "sid-old" });
    expect(await getCurrentUserAndPermissions()).toEqual({ session: null, perms: null, userId: null });
    expect(await getCurrentUserPermissions()).toBeNull();
  });

  it("honours a pre-single-session token only until the user signs in on the app", async () => {
    h.authorization = await bearer({ uid: "u1" });
    h.user = dbUser({ mobileSessionId: null });
    expect((await getCurrentUserAndPermissions()).userId).toBe("u1");
    h.user = dbUser({ mobileSessionId: "sid-current" });
    expect((await getCurrentUserAndPermissions()).userId).toBeNull();
  });

  it("leaves web sessions alone, whatever the app session", async () => {
    h.webSession = { user: { id: "u1" } };
    h.authorization = await bearer({ uid: "u1", sid: "sid-old" });
    const r = await getCurrentUserAndPermissions();
    expect(r.userId).toBe("u1");
    expect(r.perms).not.toBeNull();
  });
});

describe("POST /api/auth/mobile-login", () => {
  const post = (body: unknown) =>
    login(new Request("http://x/api/auth/mobile-login", { method: "POST", body: JSON.stringify(body) }));

  it("starts a new app session with the phone's name and puts its id in the token", async () => {
    h.user = dbUser({ username: "bde", passwordHash: bcrypt.hashSync("pw", 4) });
    const res = await post({ username: "BDE ", password: "pw", device: "Google Pixel 8" });
    expect(res.status).toBe(200);
    const { token } = await res.json();
    const data = h.update.mock.calls[0][0].data;
    expect(data.mobileSessionDevice).toBe("Google Pixel 8");
    expect(data.mobileSessionAt).toBeInstanceOf(Date);
    expect(await readAppToken(`Bearer ${token}`)).toEqual({ uid: "u1", sid: data.mobileSessionId });
  });

  it("accepts older app builds that send no device", async () => {
    h.user = dbUser({ username: "bde", passwordHash: bcrypt.hashSync("pw", 4) });
    expect((await post({ username: "bde", password: "pw" })).status).toBe(200);
    expect(h.update.mock.calls[0][0].data.mobileSessionDevice).toBeNull();
  });

  it("touches no session on a wrong password", async () => {
    h.user = dbUser({ username: "bde", passwordHash: bcrypt.hashSync("pw", 4) });
    expect((await post({ username: "bde", password: "nope" })).status).toBe(401);
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe("/api/auth/mobile-session", () => {
  it("reports an active session", async () => {
    const res = await sessionGET(req("GET", await bearer({ uid: "u1", sid: "sid-current" })));
    expect(await res.json()).toEqual({ status: "active" });
  });

  it("reports when and where a replaced session was replaced", async () => {
    const res = await sessionGET(req("GET", await bearer({ uid: "u1", sid: "sid-old" })));
    expect(await res.json()).toEqual({ status: "replaced", at: "2026-11-17T09:00:00.000Z", device: "samsung SM-A546E" });
  });

  it("reports deactivated accounts and dead tokens", async () => {
    h.user = dbUser({ isActive: false });
    expect(await (await sessionGET(req("GET", await bearer({ uid: "u1", sid: "sid-current" })))).json()).toEqual({ status: "inactive" });
    expect(await (await sessionGET(req("GET"))).json()).toEqual({ status: "expired" });
    expect(await (await sessionGET(req("GET", await bearer({ uid: "u1", sid: "sid-current" }, -60)))).json()).toEqual({ status: "expired" });
  });

  it("sign-out retires only the token's own session", async () => {
    await sessionDELETE(req("DELETE", await bearer({ uid: "u1", sid: "sid-current" })));
    const arg = h.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "u1", mobileSessionId: "sid-current" });
    expect(arg.data.mobileSessionId).not.toBe("sid-current");
    expect(arg.data.mobileSessionDevice).toBeNull();
  });

  it("sign-out without a session id or token changes nothing", async () => {
    await sessionDELETE(req("DELETE", await bearer({ uid: "u1" })));
    await sessionDELETE(req("DELETE"));
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});
