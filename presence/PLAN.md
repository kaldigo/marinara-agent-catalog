# Presence Package Plan

## Scope

- Expose Presence as a tracker feature agent.
- Run only in chats where the Presence tracker is enabled.
- Own message attendance and its native Hide From AI projection.
- Leave native chat summaries entirely unchanged.

## Data Model

Each stamped message stores positive attendance:

```json
{
  "marinaraPresence": {
    "version": 1,
    "presentCharacterIds": ["char-a"],
    "updatedAt": "2026-08-17T00:00:00.000Z"
  },
  "hiddenFromAICharacterIds": ["char-b"]
}
```

The positive record is Presence's source of truth. `hiddenFromAICharacterIds` is the native projection consumed by Marinara.

## Behavior

- Stamp post-only, generated user, assistant, and narrator messages with the active roster.
- Preserve attendance on regenerate and continue.
- Initialize older chats when Presence is enabled.
- Backfill newly added characters as absent from historical messages.
- Preserve global Hide From AI and non-roster hidden IDs.
- Union always-present characters into existing and future message attendance.
- Provide per-message and range mutation handlers.
- Provide `/presence resync` to rebuild native hidden IDs from positive attendance.

## Integration

- Use `_mari-bridge` for slash command capture and the chat-settings contribution slot.
- Register `/presence` as a package command.
- Augment `/hide` and `/unhide` only when the first argument identifies a character rather than a native range.
- Use an avatar-based multi-select in Chat Settings for always-present characters.
