/**
 * Saying which way the microphone failed.
 *
 * The first version of this collapsed every cause into "check the browser's
 * permission for this site" — and the first real failure in production was a
 * `Permissions-Policy: microphone=()` header of ours, which disabled the
 * microphone for every origin including our own. No browser setting could have
 * fixed it, and the message sent someone to look at one anyway.
 *
 * A confident wrong diagnosis costs more than a vague one, because it gets
 * acted on. These distinguish the causes that have genuinely different remedies,
 * and where the browser itself cannot distinguish two of them, this says so
 * rather than picking the likelier and being wrong the rest of the time.
 */
export function microphoneErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      // One error name, two very different causes: the person clicked Block, or
      // a response header refused before any prompt appeared. Naming both is the
      // honest answer, and "you saw no prompt" is the detail that separates them.
      return "The browser blocked the microphone. Allow it for this site — and if you never saw a prompt, tell an admin, because the site itself may be refusing.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Check one is plugged in and selected as the input device.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is busy — another app or tab is using it. Close that and try again.";
    default:
      return "The microphone could not be started. Try again, and tell an admin if it keeps happening.";
  }
}
