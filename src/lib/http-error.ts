/**
 * Throwable HTTP error.
 *
 * Route handlers wrapped with `withApiHandler` (see ./api) turn an HttpError
 * into a JSON response with its status; any other thrown value becomes a safe
 * generic 500. This lets deep helpers (validators, services) signal an HTTP
 * outcome by throwing, instead of every layer threading NextResponse around.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, code = "bad_request") => new HttpError(400, message, code);
export const unauthorized = (message = "unauthorized") => new HttpError(401, message, "unauthorized");
export const forbidden = (message = "forbidden") => new HttpError(403, message, "forbidden");
export const notFound = (message = "not_found") => new HttpError(404, message, "not_found");
export const conflict = (message: string, code = "conflict") => new HttpError(409, message, code);
