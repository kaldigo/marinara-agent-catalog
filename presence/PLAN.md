# Presence Package Plan

## 1. Package Source

- Keep `packages/presence-extension` as legacy reference source.
- Build `packages/presence` as the clean package-era implementation.
- Expose Presence as a tracker-category feature agent.
- Run only for chats where the Presence tracker is enabled in active agents.

## 2. Data Model

Use Marinara's native per-character Hide From AI field as the message presence
state.

```json
{
  "hiddenFromAICharacterIds": ["char-b"]
}
```

Characters listed in `hiddenFromAICharacterIds` are absent from that message.
Characters in the current roster that are not listed are present. Presence does
not stamp per-message shadow metadata.

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

- Detect summary creation, generation, edit, and delete via bridge diffing plus
  route/generation-completion hints where available.
- Mirror summaries into a Presence-owned lorebook keyed by summary entry ID.
- Store mirror enabled preferences per chat by summary ID.
- Disable native summary entries only after a successful mirror rebuild.

## 6. Commands

- Use `_mari-bridge` command routing.
- Provide `/presence <set|unset> <character> <range>`.
- Hijack `/hide <character> <range>` and `/unhide <character> <range>` only when
  the first argument is not a native message range.

## 7. Upstream Replacement Points

Tracked in `packages/_mari-bridge/UPSTREAM-GAPS.md`:

- Slash command contribution API.
- Summary lifecycle events.
- Pre-prompt generation hook.
- Per-character summary audience.
- Message action slot.
- Roster change event.
- Bulk scoped Hide From AI route.
