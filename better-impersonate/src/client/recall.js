const RECALL_PREFIX = "mari-better-impersonate:recall:";
const LEGACY_GUIDANCE_PREFIX = "mari-si-guidance:";

function emptyRecall() {
  return { lastGuidance: "", lastGeneratedDraft: "" };
}

export function readRecall(storage, chatId) {
  const id = String(chatId ?? "").trim();
  if (!storage || !id) return emptyRecall();
  try {
    const raw = storage.getItem(`${RECALL_PREFIX}${id}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        lastGuidance: typeof parsed?.lastGuidance === "string" ? parsed.lastGuidance : "",
        lastGeneratedDraft: typeof parsed?.lastGeneratedDraft === "string" ? parsed.lastGeneratedDraft : "",
      };
    }
    return {
      lastGuidance: storage.getItem(`${LEGACY_GUIDANCE_PREFIX}${id}`) || "",
      lastGeneratedDraft: "",
    };
  } catch {
    return emptyRecall();
  }
}

function writeRecall(storage, chatId, recall) {
  const id = String(chatId ?? "").trim();
  if (!storage || !id) return;
  try {
    storage.setItem(`${RECALL_PREFIX}${id}`, JSON.stringify({
      version: 1,
      lastGuidance: recall.lastGuidance,
      lastGeneratedDraft: recall.lastGeneratedDraft,
    }));
    storage.removeItem?.(`${LEGACY_GUIDANCE_PREFIX}${id}`);
  } catch {
    // Recall is optional and must never block draft generation.
  }
}

export function rememberImpersonateRequest(storage, chatId, input) {
  const guidance = String(input ?? "");
  const recall = readRecall(storage, chatId);
  if (!guidance || guidance === recall.lastGeneratedDraft) return recall;
  const next = { ...recall, lastGuidance: guidance };
  writeRecall(storage, chatId, next);
  return next;
}

export function rememberGeneratedDraft(storage, chatId, output) {
  const recall = readRecall(storage, chatId);
  const next = { ...recall, lastGeneratedDraft: String(output ?? "") };
  writeRecall(storage, chatId, next);
  return next;
}

export const __test = Object.freeze({ RECALL_PREFIX, LEGACY_GUIDANCE_PREFIX });
