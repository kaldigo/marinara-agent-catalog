function stripTemplateUserPrefix(value) {
  return String(value || "").trim().replace(/^\{\{user\}\}\s*:\s*/iu, "").trim();
}

function escapeRegExp(value) {
  const specials = new Set(["\\", "^", "$", ".", "|", "?", "*", "+", "(", ")", "[", "]", "{", "}"]);
  return Array.from(String(value), (ch) => (specials.has(ch) ? `\\${ch}` : ch)).join("");
}

function stripImpersonateSpeakerPrefix(text, personaName) {
  let next = String(text || "");
  const cleanedPersonaName = stripTemplateUserPrefix(personaName);
  const labels = ["{{user}}", cleanedPersonaName].filter(Boolean);

  for (let pass = 0; pass < 2; pass += 1) {
    const before = next;
    for (const label of labels) {
      const pattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*:\\s*`, "iu");
      next = next.replace(pattern, "");
    }
    if (next === before) break;
  }

  return next;
}

function readScopedRegexMode(chat) {
  const mode = readChatMetadata(chat).scopedRegexMode;
  return mode === "exclusive" || mode === "chat" ? mode : "disabled";
}

function isRegexEnabled(value) {
  return value === true || value === "true";
}

function readRegexApplyMode(script) {
  return script?.applyMode === "prompt" || script?.applyMode === "display" || script?.applyMode === "both"
    ? script.applyMode
    : script?.promptOnly === true || script?.promptOnly === "true"
      ? "prompt"
      : "display";
}

function readRegexStrings(value) {
  return parseJsonArray(value).filter((entry) => typeof entry === "string");
}

function readRegexPlacements(value) {
  return readRegexStrings(value).filter((entry) => entry === "ai_output" || entry === "user_input");
}

function resolveRegexMacros(value, regexContext) {
  return String(value || "")
    .replace(/\{\{\s*user\s*\}\}/giu, regexContext.personaName || "User")
    .replace(/\{\{\s*char\s*\}\}/giu, regexContext.characterName || "Character")
    .replace(/\{\{\s*noop\s*\}\}/giu, "")
    .replace(/\{\{\s*trim\s*\}\}/giu, "");
}

function resolveRegexPattern(value, regexContext) {
  return String(value || "").replace(/\{\{[\s\S]*?\}\}/gu, (macro) => escapeRegExp(resolveRegexMacros(macro, regexContext)));
}

function expandRegexReplacement(replacement, matchArgs) {
  const match = String(matchArgs[0] ?? "");
  const maybeGroups = matchArgs[matchArgs.length - 1];
  const hasGroups = maybeGroups && typeof maybeGroups === "object";
  const input = String(matchArgs[matchArgs.length - (hasGroups ? 2 : 1)] ?? "");
  const offset = Number(matchArgs[matchArgs.length - (hasGroups ? 3 : 2)] ?? 0);
  const captures = matchArgs.slice(1, hasGroups ? -3 : -2).map((capture) => (capture == null ? "" : String(capture)));
  const groups = hasGroups ? maybeGroups : null;
  let result = "";
  let caseMode = "";
  let oneShot = "";

  const applyCase = (value) => {
    let next = caseMode === "upper" ? value.toUpperCase() : caseMode === "lower" ? value.toLowerCase() : value;
    if (oneShot && next) {
      next = oneShot === "upper" ? next.charAt(0).toUpperCase() + next.slice(1) : next.charAt(0).toLowerCase() + next.slice(1);
      oneShot = "";
    }
    return next;
  };

  for (let i = 0; i < replacement.length; i += 1) {
    const ch = replacement[i];
    const next = replacement[i + 1];
    if (ch === "\\" && next && "ULEul".includes(next)) {
      if (next === "U") caseMode = "upper";
      else if (next === "L") caseMode = "lower";
      else if (next === "E") caseMode = "";
      else if (next === "u") oneShot = "upper";
      else if (next === "l") oneShot = "lower";
      i += 1;
      continue;
    }
    if (ch !== "$") {
      result += applyCase(ch || "");
      continue;
    }

    if (next === "$") {
      result += applyCase("$");
      i += 1;
    } else if (next === "&") {
      result += applyCase(match);
      i += 1;
    } else if (next === "`") {
      result += applyCase(input.slice(0, offset));
      i += 1;
    } else if (next === "'") {
      result += applyCase(input.slice(offset + match.length));
      i += 1;
    } else if (next === "<") {
      const close = replacement.indexOf(">", i + 2);
      if (close > i) {
        const name = replacement.slice(i + 2, close);
        result += applyCase(groups && Object.prototype.hasOwnProperty.call(groups, name) ? String(groups[name] ?? "") : "");
        i = close;
      } else {
        result += applyCase("$");
      }
    } else if (/\d/u.test(next || "")) {
      const two = replacement.slice(i + 1, i + 3);
      if (/^\d{2}$/u.test(two) && Number(two) >= 1 && Number(two) <= captures.length) {
        result += applyCase(captures[Number(two) - 1] || "");
        i += 2;
      } else {
        const index = Number(next);
        result += applyCase(index >= 1 && index <= captures.length ? captures[index - 1] || "" : `$${next}`);
        i += 1;
      }
    } else {
      result += applyCase("$");
    }
  }

  return result;
}

function applyRegexReplacementCompat(text, regex, replacement) {
  return text.replace(regex, (...args) => expandRegexReplacement(replacement, args));
}

function applyActiveAiOutputRegex(text, regexContext) {
  if (!regexContext?.scripts?.length) return text;
  let result = String(text || "");
  for (const script of regexContext.scripts) {
    if (!isRegexEnabled(script.enabled)) continue;
    const applyMode = readRegexApplyMode(script);
    if (applyMode !== "display" && applyMode !== "both") continue;
    if (!readRegexPlacements(script.placement).includes("ai_output")) continue;

    const targetCharacterIds = readRegexStrings(script.targetCharacterIds);
    if (targetCharacterIds.length > 0) {
      if (regexContext.scopedRegexMode === "disabled") continue;
      if (regexContext.scopedRegexMode === "exclusive") continue;
    }
    if (typeof script.minDepth === "number" && 0 < script.minDepth) continue;
    if (typeof script.maxDepth === "number" && 0 > script.maxDepth) continue;

    try {
      const findRegex = resolveRegexPattern(script.findRegex, regexContext);
      if (!findRegex) continue;
      const regex = new RegExp(findRegex, typeof script.flags === "string" ? script.flags : "");
      const replacement = resolveRegexMacros(script.replaceString, regexContext);
      result = applyRegexReplacementCompat(result, regex, replacement);
      for (const trim of readRegexStrings(script.trimStrings)) {
        const resolvedTrim = resolveRegexMacros(trim, regexContext);
        if (resolvedTrim) result = result.split(resolvedTrim).join("");
      }
    } catch {}
  }
  return result;
}

function renderGeneratedText(text, personaName, regexContext) {
  return stripImpersonateSpeakerPrefix(applyActiveAiOutputRegex(text, regexContext), personaName);
}

async function readRegexContext(chat, personaName) {
  const [scripts, characterName] = await Promise.all([readRegexScripts(), readPrimaryCharacterName(chat)]);
  return {
    scripts,
    personaName,
    characterName,
    scopedRegexMode: readScopedRegexMode(chat),
  };
}
