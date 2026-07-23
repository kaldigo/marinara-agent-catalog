# Presence Package Plan

## 1. Package Source

- Keep `packages/presence-extension` as migration/reference source.
- Build `packages/presence` as the clean package-era implementation.
- Keep `includeInMain: false` until it intentionally replaces the published
  `presence-extension` package that currently owns the same install id.

## 2. Data Model

Store Presence-owned metadata under `message.extra.marinaraPresencePackage`.

```json
{
  "version": 1,
  "presentCharacterIds": ["char-a"],
  "ownedHiddenFromAICharacterIds": ["char-b"],
  "updatedAt": "2026-07-23T00:00:00.000Z"
}
```

`hiddenFromAICharacterIds` remains Marinara's source of truth for prompt scoping.
Presence removes only IDs it previously owned, then adds the IDs absent from
`presentCharacterIds`.

## 3. Message Save

On message create/save, stamp the message with currently active chat characters.
Do not use all roster characters when some are inactive.

If all roster characters are active, Presence may store compact default metadata,
but must still be able to backfill future newly added characters.

## 4. Roster Backfill

When a chat gains characters:

- Compare current roster to the stored Presence roster snapshot.
- For existing messages, treat unstored presence as the previous roster.
- Add newly added character IDs to Presence-owned hidden IDs.
- Do not touch globally hidden messages.
- Do not remove manual per-character hidden IDs.
- Rebuild summary lorebook filters.

## 5. Summaries

- Detect summary creation, generation, edit, toggle, and delete via bridge diffing
  plus route/SSE hints where available.
- Mirror summaries into a Presence-owned lorebook keyed by summary entry ID.
- Store mirror enabled preferences per chat by summary ID.
- Disable native summary entries only after a successful mirror rebuild.

## 6. Commands

- Use `_mari-bridge` command routing.
- Provide `/presence <set|unset> <character> <range>`.
- Hijack `/hide <character> <range>` and `/unhide <character> <range>` only when
  the first argument is not a native message range.

## 7. Migration

- Detect `message.extra.marinaraPresence` from the extension.
- Map old character names to current roster IDs where needed.
- Convert into `marinaraPresencePackage`.
- Preserve existing global and manual hidden state.
- Write a migration marker so the same chat is not migrated twice.

## 8. Upstream Replacement Points

Tracked in `packages/_mari-bridge/UPSTREAM-GAPS.md`:

- Slash command contribution API.
- Summary lifecycle events.
- Pre-prompt generation hook.
- Per-character summary audience.
- Message action slot.
- Roster change event.
- Bulk scoped Hide From AI route.
