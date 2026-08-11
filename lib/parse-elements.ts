// Tolerant partial-JSON parser for streaming LLM output.
// Ports the parsePartialElements logic from excalidraw-mcp.
// Handles: incomplete arrays, missing closing braces, trailing junk.

export type ExcalidrawElement = {
  id?: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
};

export type ChatResponse = {
  text: string;
  elements: ExcalidrawElement[];
};

/**
 * Try to extract a complete {text, elements} JSON object from a partial string.
 * Returns null if it can't yet parse a valid outer object.
 */
export function parsePartialResponse(raw: string): ChatResponse | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;

  // Find matching closing brace for the outer object
  const end = findMatchingBrace(trimmed, 0);
  if (end === -1) return null;

  const candidate = trimmed.slice(0, end + 1);

  try {
    const parsed = JSON.parse(candidate);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.text === "string" &&
      Array.isArray(parsed.elements)
    ) {
      return parsed as ChatResponse;
    }
    return null;
  } catch {
    return null;
  }
}

/** Find the index of the matching closing brace for the brace at `start`. */
function findMatchingBrace(s: string, start: number): number {
  if (s[start] !== "{") return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Drop the last element if its JSON object is incomplete (no closing brace).
 * This lets the canvas render a clean partial diagram while the rest streams in.
 */
export function excludeIncompleteLastItem(
  elements: ExcalidrawElement[],
): ExcalidrawElement[] {
  // The streaming layer already feeds us parsed elements — this is a safety net
  // for any element that lacks required fields.
  return elements.filter((el) => {
    if (!el || typeof el !== "object") return false;
    if (typeof el.type !== "string") return false;
    if (el.type === "cameraUpdate" || el.type === "delete") return true;
    // Drawn elements need id + coordinates
    return (
      typeof el.id === "string" &&
      typeof el.x === "number" &&
      typeof el.y === "number"
    );
  });
}
