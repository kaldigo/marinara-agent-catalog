# Presence Package Plan

## Scope

- Expose Presence as a tracker feature agent.
- Run only in chats where the Presence tracker is enabled.
- Use native per-character Hide From AI state as the sole message authority.
- Leave native chat summaries entirely unchanged.

## Data Model

Each stamped message uses Marinara's native negative visibility list:

```json
{
  "hiddenFromAICharacterIds": ["char-b"]
}
```

`hiddenFromAICharacterIds` is both the source of truth and the field consumed by Marinara. Chat metadata stores only a monotonic known-character set for detecting new members and the configured omnipresent IDs.

## Behavior

- Stamp post-only, generated user, assistant, and narrator messages with the active roster.
- Preserve attendance on regenerate and continue.
- Seed the known-character set without rewriting history when Presence is enabled.
- Backfill genuinely new characters as absent from historical messages.
- Preserve global Hide From AI and non-roster hidden IDs.
- Remove only newly omnipresent characters from existing hidden lists and keep them visible in future messages.
- Preserve native visibility on regenerate and continue.
- Provide target-only per-message and range mutation handlers.
- Provide `/presence resync` to repeat new-character backfill and omnipresent repair.

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
- Presence owns only targeted native visibility mutations and the reconciliation
  needed for newly added and omnipresent characters.
- No DOM observers, repeated message scans, button probing, or package-local
  copies of native settings and generation behavior.
- Verify enable/disable isolation, newly added characters, regenerate,
  continue, post-only messages, generated user messages, always-present edits,
  native range command pass-through, and cleanup across chat navigation.
