/**
 * What to tell a reviewer when "Process selected" on the Approvals queue
 * fails as a whole (not per row: those come back inside a 200).
 *
 * The page used to say "Could not process the batch — try again" for every
 * non-OK reply, which hid the cause: an expired login (401), a timeout or
 * crash (5xx, where some rows may already be approved), or the database not
 * answering (503). Pure and client-safe.
 */

export type BulkFailure = {
  message: string;
  /** Show a "Sign in again" link (ticks are kept in this browser). */
  signIn: boolean;
  /** Reload the list: rows that went through before the failure drop off. */
  refresh: boolean;
};

/** `status` 0 = the request never got a reply (offline, connection dropped). */
export function bulkFailure(status: number, code?: string | null): BulkFailure {
  if (status === 401 || code === "unauthenticated" || code === "unauthorized") {
    return {
      message: "Your login has expired. Sign in again; your ticks are kept on this page.",
      signIn: true,
      refresh: false,
    };
  }
  if (status === 403 || code === "forbidden") {
    return { message: "You don't have permission to approve / reject.", signIn: false, refresh: false };
  }
  if (status === 400) {
    return {
      message: "The selection couldn't be read. Reload the page and try again (error 400).",
      signIn: false,
      refresh: true,
    };
  }
  if (status === 503 || code === "db_unavailable") {
    return {
      message: "The database didn't answer. Wait a few seconds and press Process selected again (error 503).",
      signIn: false,
      refresh: false,
    };
  }
  if (status === 0) {
    return {
      message:
        "No reply from the server (connection dropped). The list has been reloaded: rows that went through are gone from it. Press Process selected again for the rest.",
      signIn: false,
      refresh: true,
    };
  }
  return {
    message: `The server stopped before finishing (error ${status}). The list has been reloaded: rows that went through are gone from it. Press Process selected again for the rest.`,
    signIn: false,
    refresh: true,
  };
}
