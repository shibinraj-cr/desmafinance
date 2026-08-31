/**
 * Addressing a re-marketing touch by template instead of by URL.
 *
 * A Wabis workflow had one approved template welded inside it, so "which touch"
 * and "which URL" were the same question and the CRM never had to know what it
 * was actually sending. The Cloud API addresses a template by name and language,
 * which means that knowledge has to come back into the CRM — and it only exists
 * in somebody's head and in four Wabis workflows.
 *
 * Everything here is pure so the mapping can be tested without a WABA, because
 * the failure it prevents is only otherwise visible as a Meta rejection, per
 * candidate, in production.
 */

export type TouchTemplate = {
  name: string;
  /** Exact, per touch. Meta matches on the name/language PAIR and these differ. */
  language: string;
};

/**
 * `name:language` per line, positional — line 1 is touch 1.
 *
 * Interior blanks are preserved because position IS the touch number; a touch
 * left blank is one that simply has no template yet, not a shift of everything
 * below it up a place.
 */
export function parseTouchTemplates(raw: string | null | undefined): (TouchTemplate | null)[] {
  if (!raw) return [];
  const lines = raw.split("\n").map((l) => l.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();

  return lines.map((line) => {
    if (!line) return null;
    // Split on the LAST colon, so a template name containing one survives.
    const at = line.lastIndexOf(":");
    if (at <= 0) return null;
    const name = line.slice(0, at).trim();
    const language = line.slice(at + 1).trim();
    if (!name || !language) return null;
    return { name, language };
  });
}

export function formatTouchTemplates(templates: readonly (TouchTemplate | null)[]): string {
  return templates.map((t) => (t ? `${t.name}:${t.language}` : "")).join("\n");
}

/** Comma-separated field tokens per touch, positional and newline-separated. */
export function parseTouchParams(raw: string | null | undefined): string[][] {
  if (!raw) return [];
  const lines = raw.split("\n").map((l) => l.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.map((line) =>
    line
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * The fields a touch template may draw on.
 *
 * A closed list, not free text. A token nobody recognises would otherwise send an
 * empty string into a message a candidate reads — "Hi , about your application" —
 * and Meta would accept it happily, because an empty parameter is still a
 * parameter.
 */
export const TOUCH_PARAM_TOKENS = [
  "name",
  "first_name",
  "agent",
  "agent_phone",
  "service",
  "source",
  "country",
] as const;

export type TouchParamSource = {
  name: string | null;
  agent: string | null;
  agentPhone: string | null;
  service: string | null;
  source: string | null;
  country: string | null;
};

export function resolveTouchParam(token: string, from: TouchParamSource): string | null {
  switch (token) {
    case "name":
      return from.name?.trim() || null;
    case "first_name":
      // Templates that open "Hi {{1}}" read better with one name than three.
      return from.name?.trim().split(/\s+/)[0] || null;
    case "agent":
      return from.agent?.trim() || null;
    case "agent_phone":
      return from.agentPhone?.trim() || null;
    case "service":
      return from.service?.trim() || null;
    case "source":
      return from.source?.trim() || null;
    case "country":
      return from.country?.trim() || null;
    default:
      return null;
  }
}

export type TouchParamsResult =
  | { ok: true; params: Record<string, string> }
  | { ok: false; reason: "unmapped" | "unknown_token" | "empty_value"; detail: string };

/**
 * Build the `{{1}}`, `{{2}}` … values for one send.
 *
 * Refuses rather than improvises. Meta rejects a mismatched parameter count
 * outright, and a template variable filled with an empty string produces a
 * message with a hole in it that sends perfectly happily — the candidate reads
 * "Hi ," and nothing anywhere reports a problem. Both are worse than a touch that
 * did not go and said why.
 */
export function buildTouchParams(input: {
  variableCount: number;
  tokens: readonly string[];
  from: TouchParamSource;
}): TouchParamsResult {
  if (input.variableCount === 0) return { ok: true, params: {} };

  if (input.tokens.length < input.variableCount) {
    return {
      ok: false,
      reason: "unmapped",
      detail: `the template needs ${input.variableCount} value${input.variableCount === 1 ? "" : "s"} and ${
        input.tokens.length
      } are mapped`,
    };
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < input.variableCount; i++) {
    const token = input.tokens[i];
    if (!(TOUCH_PARAM_TOKENS as readonly string[]).includes(token)) {
      return { ok: false, reason: "unknown_token", detail: `"${token}" is not a field this touch can use` };
    }
    const value = resolveTouchParam(token, input.from);
    if (!value) {
      return { ok: false, reason: "empty_value", detail: `the lead has no ${token.replace(/_/g, " ")}` };
    }
    params[String(i + 1)] = value;
  }
  return { ok: true, params };
}

/** Which transport carries the drip. Anything unrecognised means the old one. */
export function parseTransport(raw: string | null | undefined): "wabis" | "cloud" {
  return (raw ?? "").trim().toLowerCase() === "cloud" ? "cloud" : "wabis";
}
