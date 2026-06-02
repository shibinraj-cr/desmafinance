/**
 * Thin Anthropic (Claude) client wrapper. SERVER-ONLY — only import this from
 * API routes / server modules so `ANTHROPIC_API_KEY` never reaches the browser
 * bundle. Mirrors the lazy-singleton style of prisma.ts.
 *
 * The whole app degrades gracefully when no key is set: `isAiEnabled()` returns
 * false and callers fall back to the deterministic rule-based narrative.
 */
import Anthropic from "@anthropic-ai/sdk";

/** Default model for planner narratives. Override with PLANNER_AI_MODEL. */
export const PLANNER_AI_MODEL = process.env.PLANNER_AI_MODEL || "claude-sonnet-4-6";

/** True when an API key is configured, i.e. live Claude calls are possible. */
export function isAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const globalForAnthropic = globalThis as unknown as { anthropic?: Anthropic };

/**
 * Lazily construct (and cache) the Anthropic client. Throws if called without a
 * key — guard call sites with `isAiEnabled()` first.
 */
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check isAiEnabled() before calling getAnthropic().");
  }
  if (!globalForAnthropic.anthropic) {
    globalForAnthropic.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return globalForAnthropic.anthropic;
}
