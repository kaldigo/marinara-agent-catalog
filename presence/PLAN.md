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

- Keep Presence chat-specific: the package runs only when its normal feature
  agent is added to the active Roleplay chat.
- Use Marinara's native message visibility fields and message update APIs. Do
  not create a second prompt-history filter or summary system.
- Use `_mari-bridge` only for missing lifecycle events, slash-command routing,
  active-chat state, and the `agent.settings` extension point.
- Register `/presence` as a package command.
- Augment `/hide` and `/unhide` only when the first argument identifies a character rather than a native range.
- Add an avatar-based multi-select directly to the existing native Presence
  agent card for always-present characters. Do not replace the agent editor or
  create a package-owned settings screen.

## Native-first constraints

- Marinara owns chat membership, agent enablement, the settings card, message
  persistence, and the native Hide From AI projection.
- Presence owns only its positive attendance record and the reconciliation
  needed to keep the native projection correct.
- No DOM observers, repeated message scans, button probing, or package-local
  copies of native settings and generation behavior.
- Verify enable/disable isolation, newly added characters, regenerate,
  continue, post-only messages, generated user messages, always-present edits,
  native range command pass-through, and cleanup across chat navigation.
