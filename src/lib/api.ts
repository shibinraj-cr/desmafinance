import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "./logger";
import { HttpError } from "./http-error";

/**
 * Wrap a Next.js route handler so that:
 *   - an uncaught throw becomes a logged, safe `500 {"error":"internal_error"}`
 *     (no stack/message leaked to the client),
 *   - a thrown `ZodError` becomes `400 {"error":"validation_error", issues}`,
 *   - a thrown `HttpError` maps to its own status + code.
 *
 * It is purely additive: explicit `NextResponse` returns inside the handler
 * (existing 200/400/403 paths) are passed straight through. Adopt it by
 * changing `export async function POST(...)` to
 * `export const POST = withApiHandler(async (...) => { ... })`.
 *
 * The rest-args generic preserves the handler's own signature, so it works for
 * both static routes `(req)` and dynamic routes `(req, { params })`.
 */
export function withApiHandler<A extends unknown[]>(
  handler: (req: Request, ...args: A) => Promise<Response> | Response,
) {
  return async (req: Request, ...args: A): Promise<Response> => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      return toErrorResponse(err, req);
    }
  };
}

/** Map an unknown thrown value to a JSON error response (and log 5xx/unknown). */
export function toErrorResponse(err: unknown, req?: Request): NextResponse {
  const path = req ? safePath(req) : undefined;
  const method = req?.method;

  if (err instanceof ZodError) {
    return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
  }

  if (err instanceof HttpError) {
    // Expected client errors (4xx) are noise at error level; log them as warn.
    const ctx = { path, method, status: err.status, code: err.code, message: err.message };
    if (err.status >= 500) logger.error("route_http_error", ctx);
    else logger.warn("route_http_error", ctx);
    return NextResponse.json({ error: err.code ?? "error", message: err.message }, { status: err.status });
  }

  logger.error("unhandled_route_error", {
    path,
    method,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

function safePath(req: Request): string | undefined {
  try {
    return new URL(req.url).pathname;
  } catch {
    return undefined;
  }
}
