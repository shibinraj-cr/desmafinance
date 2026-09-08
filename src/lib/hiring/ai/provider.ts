import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, isAiEnabled } from "@/lib/anthropic";

/**
 * The hiring module's one AI seam. SERVER-ONLY — nothing here may be imported
 * from a client component, so the key never reaches the browser bundle.
 *
 * Provider-agnostic on purpose: features call `generateJson` / `generateText`
 * and never touch a vendor SDK, so swapping providers is one file. Every call
 * goes through `meter()` in ./credits, which is what makes the credits meter
 * honest rather than decorative.
 */

/** Configurable; defaults to the most capable model. */
export const HIRING_AI_MODEL = process.env.HIRING_AI_MODEL || "claude-opus-5";

/**
 * Bumped whenever a prompt changes. Stored alongside every score so an old
 * decision can be read back with the prompt that actually produced it.
 */
export const HIRING_PROMPT_VERSION = "hiring-2026-09-03";

export type AiUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  promptVersion: string;
};

export type AiJsonResult = { data: unknown } & AiUsage;
export type AiTextResult = { text: string } & AiUsage;

export interface HiringAiProvider {
  readonly name: string;
  /** Free-form prose (job descriptions, outreach drafts, prep packets). */
  generateText(opts: {
    system: string;
    user: string;
    maxTokens?: number;
    effort?: "low" | "medium" | "high";
  }): Promise<AiTextResult>;
  /**
   * Schema-constrained JSON. Used wherever the output feeds a stored decision
   * (rubric scores, parsed résumés) — a free-text answer we then regex would be
   * the bug factory.
   */
  generateJson(opts: {
    system: string;
    user: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
    effort?: "low" | "medium" | "high";
    /**
     * PDFs to read alongside the prompt (résumé parsing). Kept as a first-class
     * option rather than "extract the text first" because a PDF's text layer is
     * exactly where a two-column CV turns into interleaved nonsense.
     */
    documents?: { mediaType: "application/pdf"; base64: string }[];
  }): Promise<AiJsonResult>;
}

class AnthropicProvider implements HiringAiProvider {
  readonly name = "anthropic";

  async generateText(opts: {
    system: string;
    user: string;
    maxTokens?: number;
    effort?: "low" | "medium" | "high";
  }): Promise<AiTextResult> {
    const client = getAnthropic();
    const res = await client.messages.create({
      model: HIRING_AI_MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      output_config: { effort: opts.effort ?? "medium" },
      messages: [{ role: "user", content: opts.user }],
    });
    return {
      text: textOf(res),
      model: res.model,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      promptVersion: HIRING_PROMPT_VERSION,
    };
  }

  async generateJson(opts: {
    system: string;
    user: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
    effort?: "low" | "medium" | "high";
    documents?: { mediaType: "application/pdf"; base64: string }[];
  }): Promise<AiJsonResult> {
    const client = getAnthropic();
    // Documents go before the text block, which is what the API expects.
    const content: Anthropic.ContentBlockParam[] = [
      ...(opts.documents ?? []).map(
        (d): Anthropic.ContentBlockParam => ({
          type: "document",
          source: { type: "base64", media_type: d.mediaType, data: d.base64 },
        }),
      ),
      { type: "text", text: opts.user },
    ];
    const res = await client.messages.create({
      model: HIRING_AI_MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      output_config: {
        effort: opts.effort ?? "medium",
        format: { type: "json_schema", schema: opts.schema },
      },
      messages: [{ role: "user", content }],
    });
    const raw = textOf(res);
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("The model returned output that was not valid JSON.");
    }
    return {
      data,
      model: res.model,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      promptVersion: HIRING_PROMPT_VERSION,
    };
  }
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

let cached: HiringAiProvider | null = null;

/**
 * The configured provider, or null when no key is set. Every caller must
 * handle null and degrade to a manual path — AI is an assist here, never a
 * dependency: a recruiter with no API key can still write a job description
 * and move a candidate.
 */
export function getAiProvider(): HiringAiProvider | null {
  if (!isAiEnabled()) return null;
  if (!cached) cached = new AnthropicProvider();
  return cached;
}

export { isAiEnabled };
