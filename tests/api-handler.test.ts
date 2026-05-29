/**
 * Tests for the API error-handling wrapper and structured logger
 * (src/lib/api.ts, src/lib/logger.ts, src/lib/http-error.ts).
 *
 * The wrapper is the seam that turns the codebase's many unguarded route
 * handlers from "500 with a stack trace" into logged, safe JSON errors, so its
 * mapping and its no-leak guarantee are pinned here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z, ZodError } from "zod";
import { withApiHandler, toErrorResponse } from "@/lib/api";
import { HttpError, forbidden } from "@/lib/http-error";
import { logger, setLogSink } from "@/lib/logger";

function req(method = "POST") {
  return new Request("http://test.local/api/sample", { method });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  setLogSink(null);
});

describe("withApiHandler", () => {
  it("passes a successful response straight through", async () => {
    const handler = withApiHandler(async () =>
      Response.json({ ok: true }, { status: 200 }),
    );
    const res = await handler(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("forwards dynamic-route context (params) to the handler", async () => {
    const handler = withApiHandler(async (_req: Request, ctx: { params: { id: string } }) =>
      Response.json({ id: ctx.params.id }),
    );
    const res = await handler(req(), { params: { id: "42" } });
    expect(await res.json()).toEqual({ id: "42" });
  });

  it("does not catch explicit error responses returned by the handler", async () => {
    const handler = withApiHandler(async () => Response.json({ error: "forbidden" }, { status: 403 }));
    const res = await handler(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("maps a thrown HttpError to its status and code", async () => {
    const handler = withApiHandler(async () => {
      throw forbidden("nope");
    });
    const res = await handler(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", message: "nope" });
  });

  it("maps a thrown ZodError to a 400 validation_error", async () => {
    const handler = withApiHandler(async () => {
      z.object({ n: z.number() }).parse({ n: "not-a-number" });
      return Response.json({ ok: true });
    });
    const res = await handler(req());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation_error");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("turns an unexpected throw into a logged 500 without leaking the message or stack", async () => {
    const handler = withApiHandler(async () => {
      throw new Error("SECRET internal detail");
    });
    const res = await handler(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal_error" });
    // The sensitive detail is logged server-side but never returned to the client.
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("toErrorResponse", () => {
  it("logs 5xx HttpErrors at error level and 4xx at warn level", async () => {
    const r400 = toErrorResponse(new HttpError(409, "dupe", "conflict"));
    expect(r400.status).toBe(409);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();

    const r500 = toErrorResponse(new HttpError(503, "down"));
    expect(r500.status).toBe(503);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("recognises ZodError instances", async () => {
    let zerr: unknown;
    try {
      z.string().parse(123);
    } catch (e) {
      zerr = e;
    }
    expect(zerr).toBeInstanceOf(ZodError);
    const res = toErrorResponse(zerr);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation_error");
  });
});

describe("logger", () => {
  it("emits one JSON line per event carrying level and message", () => {
    logger.error("boom", { requestId: "r1" });
    expect(console.error).toHaveBeenCalledTimes(1);
    const line = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: "error", message: "boom", requestId: "r1" });
    expect(typeof parsed.time).toBe("string");
  });

  it("forwards events to a registered sink", () => {
    const sink = vi.fn();
    setLogSink(sink);
    logger.warn("careful", { a: 1 });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toBe("warn");
    expect(sink.mock.calls[0][1]).toMatchObject({ level: "warn", message: "careful", a: 1 });
  });

  it("never throws if the sink throws", () => {
    setLogSink(() => {
      throw new Error("sink exploded");
    });
    expect(() => logger.info("still fine")).not.toThrow();
  });
});
