# Presence

Package-era rewrite of **Presence** for Marinara Engine.

Presence tracks which active chat characters were present for each message and
uses Marinara's native per-character **Hide From AI** field
(`message.extra.hiddenFromAICharacterIds`) as the durable prompt-scoping layer.

This package is not published yet. `includeInMain` is `false` while it sits
beside the legacy `presence-extension` catalog package that still owns the same
install id.

## Goals

- Store presence as character IDs, not names.
- Preserve manual/global Hide From AI state.
- Backfill newly added characters so they do not inherit old scene history.
- Mirror chat summaries into a Presence-owned lorebook with per-character filters.
- Disable native chat summary injection after mirrored summaries are created.
- Use `_mari-bridge` for slash command handling and summary lifecycle detection.
- Provide a one-time migration path from `presence-extension`.

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
scoping. Presence mirrors enabled summary entries into a chat-scoped lorebook:

- First wrapper entry opens `<chat_summaries>`.
- Each summary entry uses the summary ID as the lorebook entry name.
- Each summary entry is locked and character-filtered.
- Last wrapper entry closes `</chat_summaries>`.
- User enabled/disabled mirror preferences are stored per chat by summary ID.

The native summary entries are then disabled so the same summary is not injected
globally. Mirror enabled/disabled preferences are stored per chat by summary ID.
