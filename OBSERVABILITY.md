# Error handling & observability

Most API routes historically had no `try/catch`, so an unexpected throw returned
a raw 500 with a stack trace and was never recorded anywhere (there is no error
tracker, and only a handful of `console.error` calls across the codebase). This
introduces a small, dependency-free foundation to fix that incrementally.

## What's here

| File | Purpose |
|---|---|
| `src/lib/logger.ts` | Structured logger — one JSON line per event (`level`, `message`, `time`, …). Grep-able locally; ships to a log drain in prod. `setLogSink()` forwards to Sentry/Logtail without touching call sites. |
| `src/lib/http-error.ts` | `HttpError` (+ `badRequest`/`forbidden`/`notFound`/…) — throw it from any depth to signal an HTTP outcome. |
| `src/lib/api.ts` | `withApiHandler(handler)` — wraps a route so uncaught throws become a logged, safe `500 {"error":"internal_error"}` (no stack leak), `ZodError`→400, `HttpError`→its status. |

## Adopting on a route

It's a one-line change and **purely additive** — existing explicit responses
(200/400/403) pass straight through; only the uncaught-error path changes.

```ts
// before
export async function POST(req: Request) { … }

// after
import { withApiHandler } from "@/lib/api";
export const POST = withApiHandler(async (req: Request) => { … });
```

Dynamic routes keep their context arg:

```ts
export const PATCH = withApiHandler(async (req: Request, ctx: { params: { id: string } }) => { … });
```

Once wrapped, deep helpers can `throw badRequest("…")` / `throw notFound()`
instead of returning a `NextResponse`, and the wrapper formats the response.

Reference adoption: `src/app/api/hr/leave-accrual/run/route.ts`.

## Wiring an error tracker (prod)

Add a sink once at startup (e.g. in `src/lib/prisma.ts` or an init module):

```ts
import { setLogSink } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";

setLogSink((level, payload) => {
  if (level === "error") Sentry.captureMessage(payload.message as string, { extra: payload });
});
```

## Rollout order

Wrap the highest-blast-radius routes first, then the rest:

1. **Money / payroll** — `finance/approvals/*`, `finance/transactions/*`,
   `finance/collection-plans/*`, `hr/salary/*`, `hr/leave-accrual/*`.
2. **Auth-sensitive / admin** — `admin/*`, `users/*`, `roles/*`.
3. Everything else, opportunistically as routes are touched.

Wrapping is mechanical and low-risk; do it in small batches so each diff stays
reviewable.
