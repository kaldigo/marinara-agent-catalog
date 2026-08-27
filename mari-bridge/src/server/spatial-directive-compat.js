const XML_SPATIAL_DIRECTIVE_RE = /<spatial_(move|discover)(?=\s|:|\/)\s*:?\s*([^>\r\n]*?)\s*\/>/giu;
const XML_SPATIAL_DIRECTIVE_PREFIXES = ["<spatial_move", "<spatial_discover"];

/** Convert common XML-like model output into the command syntax owned by native World Maps. */
export function normalizeAssistantSpatialDirectives(content) {
  if (typeof content !== "string" || !content.includes("<")) return content;
  return content.replace(XML_SPATIAL_DIRECTIVE_RE, (_match, command, attributes) =>
    `[spatial_${command}: ${String(attributes ?? "").trim()}]`);
}

/** Buffer XML-like spatial commands so the native square-bracket stream filter can hide them. */
export function createSpatialDirectiveCompatibilityStreamFilter() {
  let candidate = "";
  let tagOpen = false;

  return Object.freeze({
    push(content) {
      let output = "";
      for (const character of String(content ?? "")) {
        if (!candidate) {
          if (character === "<") candidate = character;
          else output += character;
          continue;
        }

        candidate += character;
        if (tagOpen) {
          if (character === ">") {
            output += normalizeAssistantSpatialDirectives(candidate);
            candidate = "";
            tagOpen = false;
          } else if (candidate.length > 8_192 || character === "\n" || character === "\r") {
            output += candidate;
            candidate = "";
            tagOpen = false;
          }
          continue;
        }

        const normalized = candidate.toLowerCase();
        if (XML_SPATIAL_DIRECTIVE_PREFIXES.some((prefix) => prefix.startsWith(normalized))) continue;
        const prefix = XML_SPATIAL_DIRECTIVE_PREFIXES.find((value) => normalized.startsWith(value));
        if (prefix) {
          const separator = candidate[prefix.length];
          if (separator === ":" || separator === "/" || /\s/u.test(separator ?? "")) {
            tagOpen = true;
            if (character === ">") {
              output += normalizeAssistantSpatialDirectives(candidate);
              candidate = "";
              tagOpen = false;
            }
            continue;
          }
        }

        output += candidate;
        candidate = "";
      }
      return output;
    },
    flush() {
      const remaining = candidate;
      candidate = "";
      tagOpen = false;
      return remaining;
    },
  });
}
