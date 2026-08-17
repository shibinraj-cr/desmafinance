import { describe, it, expect } from "vitest";
import { microphoneErrorMessage } from "@/lib/wa/microphone";

/**
 * The first version of this told everyone to check their browser permission,
 * whatever had actually gone wrong — and the first real failure was a
 * `Permissions-Policy: microphone=()` header of ours, which no browser setting
 * could have fixed. A confident wrong diagnosis costs more than a vague one,
 * because someone acts on it.
 */
describe("microphoneErrorMessage", () => {
  const named = (name: string) => Object.assign(new Error("boom"), { name });

  it("names both causes when the browser refuses, since it cannot tell them apart", () => {
    // NotAllowedError is what a user refusal AND a Permissions-Policy refusal
    // both produce, so picking one would be confidently wrong half the time.
    const message = microphoneErrorMessage(named("NotAllowedError"));
    expect(message).toMatch(/allow it for this site/i);
    expect(message).toMatch(/never saw a prompt/i);
  });

  it("sends someone to the hardware when there is no microphone", () => {
    expect(microphoneErrorMessage(named("NotFoundError"))).toMatch(/no microphone was found/i);
    expect(microphoneErrorMessage(named("OverconstrainedError"))).toMatch(/no microphone was found/i);
  });

  it("says another app has it when the device is busy", () => {
    expect(microphoneErrorMessage(named("NotReadableError"))).toMatch(/busy/i);
  });

  it("stays useful for an error it has never met", () => {
    const message = microphoneErrorMessage(named("SomethingNew"));
    expect(message.length).toBeGreaterThan(20);
    // No jargon, and no instruction that might send someone somewhere useless.
    expect(message.toLowerCase()).not.toContain("getusermedia");
  });

  it("does not throw on a non-Error", () => {
    expect(typeof microphoneErrorMessage("nope")).toBe("string");
    expect(typeof microphoneErrorMessage(null)).toBe("string");
  });
});
