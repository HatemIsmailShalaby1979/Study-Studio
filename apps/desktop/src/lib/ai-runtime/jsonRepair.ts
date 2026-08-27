// Shared structured-output parsing + JSON repair for the AI Runtime.
//
// These are provider-independent: any local model can produce markdown-wrapped,
// truncated, or slightly malformed JSON. Moving them into the runtime lets
// every provider benefit without duplicating logic.

/**
 * Find the outermost balanced JSON object `{...}` within a string, ignoring
 * braces inside string literals (including escaped quotes). Returns `null`
 * when no balanced object can be located.
 */
export function extractOutermostJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJsonFromResponse(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  cleaned = cleaned.trim();

  if (cleaned.startsWith("{")) {
    try {
      JSON.parse(cleaned);
      return cleaned;
    } catch {
      /* fall through to salvage */
    }
  }

  const extracted = extractOutermostJsonObject(cleaned);
  return extracted ?? cleaned;
}

/**
 * Lightweight JSON repair for the most common slips small local models make
 * in long structured output:
 *
 *   - trailing commas before `}` / `]`  →  removed
 *   - unquoted object keys              →  quoted
 *   - raw control characters inside strings → escaped
 *
 * The scanner only edits characters OUTSIDE of string literals, so prose inside
 * values (apostrophes, "key: value" text, etc.) is never touched. Returns the
 * (possibly unchanged) text; callers should re-attempt JSON.parse afterwards.
 */
export function repairJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
        out += ch;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch.charCodeAt(0) < 0x20) {
        switch (ch) {
          case "\n": out += "\\n"; break;
          case "\r": out += "\\r"; break;
          case "\t": out += "\\t"; break;
          case "\b": out += "\\b"; break;
          case "\f": out += "\\f"; break;
          default: out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`; break;
        }
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text.charAt(j))) j++;
      if (text.charAt(j) === "}" || text.charAt(j) === "]") continue;
      out += ch;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let k = i - 1;
      while (k >= 0 && /\s/.test(text.charAt(k))) k--;
      if (k >= 0 && (text.charAt(k) === "{" || text.charAt(k) === ",")) {
        let j = i;
        while (j < text.length && /[A-Za-z0-9_$]/.test(text.charAt(j))) j++;
        let m = j;
        while (m < text.length && /\s/.test(text.charAt(m))) m++;
        if (text.charAt(m) === ":") {
          out += `"${text.slice(i, j)}"`;
          i = j - 1;
          continue;
        }
      }
    }

    out += ch;
  }
  return out;
}

/**
 * Parse a model response into a JSON object, applying extraction then repair.
 * Throws when the result is not a JSON object (arrays/null reject).
 */
export function parseJsonResponse<T = Record<string, unknown>>(raw: string): T {
  const jsonStr = extractJsonFromResponse(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    parsed = JSON.parse(repairJson(jsonStr));
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON parse validation failed: expected an object");
  }
  return parsed as T;
}
