import { getAnthropic, isAiEnabled } from "./anthropic";

/**
 * Claude analysis of proof-of-completion documents attached to a step. Images
 * are sent as vision blocks, PDFs as document blocks; Claude returns a
 * structured verdict on whether the file evidences the step, the key facts it
 * could read, and any concerns. Server-only (imports the Anthropic client).
 */

/** Default model — overridable via env; opus for the most reliable judgement. */
export const OPS_DOC_AI_MODEL = process.env.OPS_DOC_AI_MODEL || "claude-opus-4-8";

// Image mime → the media_type literal the Messages API accepts (jpg folds to jpeg).
const IMAGE_MIME: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

/** Whether Claude can read this mime natively (image or PDF). */
export function isAnalyzableMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return m === "application/pdf" || m in IMAGE_MIME;
}

export type ProofFact = { label: string; value: string };
export type ProofVerdict = "supports" | "partial" | "insufficient" | "mismatch";
export type ProofAnalysis = {
  verdict: ProofVerdict;
  summary: string;
  concerns: string;
  facts: ProofFact[];
};

const VERDICTS: ProofVerdict[] = ["supports", "partial", "insufficient", "mismatch"];

const RESULT_SCHEMA: { [key: string]: unknown } = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: VERDICTS },
    summary: { type: "string" },
    concerns: { type: "string" },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { label: { type: "string" }, value: { type: "string" } },
        required: ["label", "value"],
      },
    },
  },
  required: ["verdict", "summary", "concerns", "facts"],
};

function buildPrompt(o: {
  fileName: string;
  stepName: string;
  stepDescription: string | null;
  candidateName: string;
  serviceName: string;
}): string {
  return [
    "You are verifying a proof-of-completion file uploaded against one step of an operations process.",
    `Candidate: ${o.candidateName}`,
    `Service: ${o.serviceName}`,
    `Step being evidenced: "${o.stepName}"${o.stepDescription ? ` — ${o.stepDescription}` : ""}`,
    `File: ${o.fileName}`,
    "",
    "Judge whether this file is valid evidence that THIS step was completed, then return:",
    '- verdict: "supports" (clearly evidences the step), "partial" (related but incomplete), "insufficient" (illegible or can\'t tell), or "mismatch" (contradicts it — e.g. wrong candidate or wrong document type).',
    "- summary: 1–3 sentences on what the document is and how it relates to the step.",
    '- concerns: red flags (wrong name, stale/expired date, illegible, missing signature or reference number), or "None." if there are none.',
    "- facts: key fields you can actually read (document type, dates, reference/application numbers, names). Empty array if nothing is legible.",
    "Only state what the document actually shows. Do not invent details.",
  ].join("\n");
}

/**
 * Analyse one proof file with Claude. Throws `ai_not_configured` when no API key
 * is set (caller should mark the doc skipped), or a generic error on API/parse
 * failure (caller marks it failed). Never persists — the caller writes the row.
 */
export async function analyzeProofDocument(opts: {
  mimeType: string;
  base64: string;
  fileName: string;
  stepName: string;
  stepDescription: string | null;
  candidateName: string;
  serviceName: string;
}): Promise<ProofAnalysis> {
  if (!isAiEnabled()) throw new Error("ai_not_configured");
  const client = getAnthropic();
  const mime = opts.mimeType.toLowerCase();

  let fileBlock;
  if (mime === "application/pdf") {
    fileBlock = { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: opts.base64 } };
  } else {
    const media = IMAGE_MIME[mime];
    if (!media) throw new Error("unsupported_mime");
    fileBlock = { type: "image" as const, source: { type: "base64" as const, media_type: media, data: opts.base64 } };
  }

  const res = await client.messages.create({
    model: OPS_DOC_AI_MODEL,
    max_tokens: 1500,
    system:
      "You are a meticulous operations document reviewer. Be precise, conservative, and only assert what the document actually shows. Always answer through the required JSON schema.",
    output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA } },
    messages: [{ role: "user", content: [fileBlock, { type: "text", text: buildPrompt(opts) }] }],
  });

  const textBlock = res.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = JSON.parse(raw) as Partial<ProofAnalysis>;

  return {
    verdict: parsed.verdict && VERDICTS.includes(parsed.verdict) ? parsed.verdict : "insufficient",
    summary: String(parsed.summary ?? "").slice(0, 4000),
    concerns: String(parsed.concerns ?? "").slice(0, 4000),
    facts: Array.isArray(parsed.facts)
      ? parsed.facts.slice(0, 30).map((f) => ({
          label: String(f?.label ?? "").slice(0, 120),
          value: String(f?.value ?? "").slice(0, 500),
        }))
      : [],
  };
}
