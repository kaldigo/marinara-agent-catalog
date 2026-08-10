# Presence

Package-era rewrite of **Presence** for Marinara Engine.

Presence tracks which active chat characters were present for each message and
uses Marinara's native per-character **Hide From AI** field
(`message.extra.hiddenFromAICharacterIds`) as the durable prompt-scoping layer.

Presence is exposed as a tracker-category feature agent. It only mutates chats
where the Presence tracker is enabled in the chat's active agent list.

## Goals

- Store presence as character IDs, not names.
- Preserve global Hide From AI state.
- Backfill newly added characters so they do not inherit old scene history.
- Let chat-level narrator/helper cards be marked always present.
- Store positive per-summary audience state by native summary ID.
- Copy enabled chat summaries into a temporary Presence-owned outlet lorebook during generation.
- Use `_mari-bridge` for slash command handling and summary lifecycle detection.

## Chat Settings

When the Presence tracker is enabled for a chat, Presence adds a compact section
to Chat Settings next to the character roster. Selecting a character there stores
that character ID in `marinaraPresencePackage.alwaysPresentCharacterIds`.

Always-present characters are kept visible in native per-character Hide From AI
state, future message stamps, roster backfill, slash command updates, and summary
audiences. Globally hidden messages remain hidden.

## Slash Commands

Presence should own:

```text
/presence set Sophie 4-46
/presence unset Sophie last 20
/hide Sophie 4-46
/unhide "Sophie Valentine" all
```

Native Marinara commands such as `/hide 4-46` and `/unhide last 20` must pass
through untouched.

## Summary Strategy

Native chat summary entries do not currently support per-character audience
scoping. Presence keeps native summary entries as the source of truth and stores
positive summary audience state in chat metadata:

```json
{
  "marinaraPresencePackage": {
    "summaryPresenceById": {
      "summary-id": ["char-a", "char-b"]
    }
  }
}
```

During normal generation, Presence temporarily copies enabled native summaries
into a chat-scoped lorebook assigned to `{{outlet::presence_chat_summaries}}`:

- Each summary entry uses the summary ID as the lorebook entry name.
- Each summary entry is locked and character-filtered.

Native summary enabled states are snapshotted, disabled for the generation
window so the global summary marker stays empty, then restored when generation
finishes. Presence also stores a pending restore record and runs a server-side
watchdog so suspended tabs or dropped generation streams can recover the native
summary state. The temporary lorebook entries are cleared afterward.
