/**
 * What a Creator knows about their own love life, as plain sentences for the briefs and the DMs:
 * a crush before dating, the partner while together, an ex after a breakup (U).
 */
import { slurpCoupleActive, slurpCoupleFor, slurpCoupleOf, type SlurpCouple } from "./slp-creator-couples.js";
import { slurpForcedCoupleLine } from "./slp-couple-words.js";
import { slurpCouplePartners, slurpNameList } from "./slp-couple-group.js";

/** An ex stays on a Creator's mind (and in their posts and chats) this long after the breakup. */
export const SLURP_EX_DAYS = 30;

/** What a Creator calls the one they are with, from that page's gender. */
export const slurpPartnerWord = (gender: string | null | undefined) =>
  gender === "male" ? "boyfriend" : gender === "female" ? "girlfriend" : "partner";

export type SlurpRelationshipOptions = {
  withId?: string | null;
  at?: Date;
  /** Pages the player runs: the one she is with is then the player, not "another Creator on Slurp". */
  playerIds?: ReadonlySet<string>;
  /** Page id → what she calls them ("boyfriend", `slurpPartnerWord`). */
  words?: ReadonlyMap<string, string>;
};

/**
 * What a Creator knows about their own love life, in one plain sentence, or "". In a chat with the
 * partner (or the ex) it says who they are to each other; anywhere else it is part of their life,
 * and for a while after a breakup the ex is too (U: exes show up in posts and DMs).
 */
export function slurpRelationshipLine(
  couples: readonly SlurpCouple[],
  creatorId: string,
  names: ReadonlyMap<string, string>,
  options: SlurpRelationshipOptions = {},
): string {
  const line = oneRelationshipLine(couples, creatorId, names, options);
  // Polyamory (0.3.5): one person in several couples hears about all of them.
  const main = options.withId ? slurpCoupleOf(couples, creatorId, options.withId) : slurpCoupleFor(couples, creatorId);
  const more = couples
    .filter((couple) => couple !== main && slurpCoupleActive(couple))
    .flatMap((couple) => {
      const who = slurpNameList(
        slurpCouplePartners(couple, creatorId).flatMap((id) => (names.has(id) ? [names.get(id)!] : [])),
      );
      if (!who) return [];
      return [
        couple.stage === "sparks"
          ? `flirting with ${who}`
          : couple.stage === "dating"
            ? `dating ${who}`
            : `with ${who}`,
      ];
    });
  return more.length ? `${line} You are polyamorous, and you are also ${more.join(", and ")}.`.trim() : line;
}

function oneRelationshipLine(
  couples: readonly SlurpCouple[],
  creatorId: string,
  names: ReadonlyMap<string, string>,
  options: SlurpRelationshipOptions,
): string {
  const at = options.at ?? new Date();
  const withThem = options.withId ? slurpCoupleOf(couples, creatorId, options.withId) : null;
  const couple = withThem ?? slurpCoupleFor(couples, creatorId) ?? slurpRecentEx(couples, creatorId, at);
  if (!couple) return "";
  // Polyamory (0.3.5): a couple of three or four names every partner; "they" for more than one.
  const partnerIds = slurpCouplePartners(couple, creatorId);
  const partner = slurpNameList(partnerIds.flatMap((id) => (names.has(id) ? [names.get(id)!] : [])));
  if (!partner) return "";
  if (partnerIds.length > 1) return slurpGroupLine(couple, partner, Boolean(withThem));
  const days = Math.max(0, Math.round((at.getTime() - Date.parse(couple.stageAt)) / 86_400_000));
  if (options.playerIds?.has(partnerIds[0]!))
    return slurpPlayerLine(couple, creatorId, partner, {
      word: options.words?.get(partnerIds[0]!) ?? "partner",
      inChat: Boolean(withThem),
      days,
    });
  const trouble = [...couple.moments].reverse().find((moment) => moment.kind === "fight" || moment.kind === "jealous");
  // A couple the player forced against a card: the card colors how it feels (slice I).
  const tone = slurpCoupleActive(couple) ? slurpForcedCoupleLine(couple, creatorId, partner) : "";
  const colored = (line: string) => (tone ? `${line} ${tone}` : line);
  if (withThem) {
    if (couple.stage === "sparks")
      return colored(`You and ${partner} have been flirting on Slurp lately. Nothing is official.`);
    if (couple.stage === "dating")
      return colored(`You and ${partner} are dating. It is new, and not official in public yet.`);
    if (couple.stage === "together")
      return colored(`${partner} is your partner: you two are together, and your fans know.`);
    if (couple.stage === "rocky")
      return colored(
        `${partner} is your partner, but things are rocky between you right now${trouble?.detail ? ` (${trouble.detail})` : ""}.`,
      );
    return couple.ending === "fizzled"
      ? `You and ${partner} flirted for a while, and it went nowhere.`
      : `${partner} is your ex. You broke up ${days <= 1 ? "just now" : `${days} days ago`}.`;
  }
  if (couple.stage === "sparks")
    return colored(`You have a crush on ${partner}, another Creator on Slurp. Nothing is official.`);
  if (couple.stage === "split")
    return `${partner} is your ex: you broke up ${days <= 1 ? "just now" : `${days} days ago`}. It still comes up now and then, and fans may ask. Say as much or as little as you would.`;
  const what =
    couple.stage === "dating"
      ? `You are dating ${partner}, another Creator on Slurp; it is still new.`
      : `You are with ${partner}, another Creator on Slurp.`;
  const rocky = couple.stage === "rocky" ? " Things are rocky between you two right now." : "";
  return colored(`${what}${rocky}`) + " They are part of your life, not the topic of everything you write.";
}

/**
 * She is with the player (Drama, "your relationship"): the one she is with, never "another Creator on
 * Slurp", and never "not the topic of everything" in her chat with them. A secret couple stays out of
 * public: she knows, her fans do not.
 */
function slurpPlayerLine(
  couple: SlurpCouple,
  creatorId: string,
  name: string,
  { word, inChat, days }: { word: string; inChat: boolean; days: number },
): string {
  const trouble = [...couple.moments].reverse().find((moment) => moment.kind === "fight" || moment.kind === "jealous");
  const tone = slurpCoupleActive(couple) ? slurpForcedCoupleLine(couple, creatorId, name) : "";
  const colored = (line: string) => (tone ? `${line} ${tone}` : line);
  const hush = couple.secret ? ` It is a secret: your fans do not know, so you never name ${name} in public.` : "";
  if (couple.stage === "sparks")
    return colored(
      inChat
        ? `You have a crush on ${name}, and ${name} flirts back. Nothing is official yet.`
        : `You have a crush on ${name}. Nothing is official.`,
    );
  if (couple.stage === "dating")
    return colored(
      `You and ${name} are dating. It is new${couple.secret ? "" : ", and not official in public yet"}.${hush}`,
    );
  if (couple.stage === "together" || couple.stage === "rocky") {
    const rocky =
      couple.stage === "rocky"
        ? ` Things are rocky between you right now${trouble?.detail ? ` (${trouble.detail})` : ""}.`
        : "";
    const known = couple.secret ? "" : inChat ? ", and your fans know" : "";
    return colored(`${name} is your ${word}: you two are together${known}.${rocky}${hush}`);
  }
  if (couple.ending === "fizzled") return `You and ${name} flirted for a while, and it went nowhere.`;
  return inChat
    ? `${name} is your ex. You broke up ${days <= 1 ? "just now" : `${days} days ago`}.`
    : `${name} is your ex: you broke up ${days <= 1 ? "just now" : `${days} days ago`}. It still comes up now and then.`;
}

/**
 * The player's relationship with a character, for an ordinary Engine chat with that character (the
 * chat bridge, `slp-chat-context.ts`): one standing fact, in the third person. "" when there is none.
 */
export function slurpChatBridgeCoupleLine(
  couple: SlurpCouple | null,
  input: { her: string; herGender: string | null | undefined; you: string; at: Date },
): string {
  if (!couple) return "";
  const { her, you } = input;
  const since = (iso: string | null) => (iso ? ` since ${iso.slice(0, 10)}` : "");
  const hush = couple.secret ? ", kept secret from her fans" : "";
  const fight = [...couple.moments].reverse().find((moment) => moment.kind === "fight" || moment.kind === "jealous");
  if (couple.stage === "sparks")
    return `${her} and ${you} have a crush on each other on Slurp; nothing is official yet.`;
  if (couple.stage === "dating") return `${her} and ${you} are dating on Slurp${since(couple.stageAt)}${hush}.`;
  if (couple.stage === "together" || couple.stage === "rocky")
    return `${her} is ${you}'s ${slurpPartnerWord(input.herGender)} on Slurp: together${since(couple.togetherAt)}${hush}.${
      couple.stage === "rocky" ? ` Things are rocky right now${fight?.detail ? ` (${fight.detail})` : ""}.` : ""
    }`;
  const days = Math.round((input.at.getTime() - Date.parse(couple.stageAt)) / 86_400_000);
  return couple.ending === "breakup" && days <= SLURP_EX_DAYS
    ? `${her} and ${you} broke up on Slurp ${days <= 1 ? "just now" : `${days} days ago`}.`
    : "";
}

/** The newest breakup of this Creator in the last `SLURP_EX_DAYS` days, or null. */
function slurpRecentEx(couples: readonly SlurpCouple[], creatorId: string, at: Date): SlurpCouple | null {
  return (
    [...couples]
      .reverse()
      .find(
        (couple) =>
          couple.ending === "breakup" &&
          !slurpCoupleActive(couple) &&
          slurpCouplePartners(couple, creatorId).length > 0 &&
          at.getTime() - Date.parse(couple.stageAt) >= 0 &&
          at.getTime() - Date.parse(couple.stageAt) < SLURP_EX_DAYS * 86_400_000,
      ) ?? null
  );
}

/** A couple of three or four, from one member's side. */
function slurpGroupLine(couple: SlurpCouple, partners: string, inChat: boolean): string {
  if (couple.stage === "split")
    return `${partners} are your exes: the relationship you had together is over. It still comes up now and then.`;
  const rocky = couple.stage === "rocky" ? " Things are rocky between you right now." : "";
  const what =
    couple.stage === "together"
      ? `You are in a polyamorous relationship with ${partners}, and your fans know.`
      : `You are dating ${partners} together, a polyamorous relationship that is still new.`;
  return inChat
    ? `${what}${rocky}`
    : `${what}${rocky} They are part of your life, not the topic of everything you write.`;
}
