# Presence

Presence is a chat-specific tracker feature for per-message character attendance in Marinara Engine Roleplay chats. It only mutates chats where the Presence agent is enabled.

## Message State

Presence stores an explicit positive attendance record in `message.extra.marinaraPresence.presentCharacterIds`. It also projects that record into Marinara's native `message.extra.hiddenFromAICharacterIds` field so prompt history is scoped by the engine itself.

The positive record remains authoritative when the roster changes. A character added later is absent from older messages unless their ID was already recorded as present. Globally hidden messages remain globally hidden.

## Lifecycle

- Existing messages are initialized when Presence is first enabled, and older package-era chats adopt their native per-character visibility when positive records are missing.
- Post-only and generation-created messages are stamped with the active roster through Mari Bridge's native pre-save message hook.
- Regenerate and continue operations are reconciled from Mari Bridge's exact native post-persistence message callback because they update an existing message instead of creating one.
- Newly added characters are hidden from historical messages using the stored positive attendance records.
- Regenerate and continue preserve existing attendance instead of replacing it with the current active roster.

## Always Present

The native Presence agent card includes a Mari Bridge avatar picker for characters that should always be present. This is intended for narrator and system-style cards. Selecting one updates existing non-globally-hidden messages and includes that character in future stamps even while inactive.

The package does not replace Marinara's agent editor or settings layout. Mari Bridge contributes only this package-specific picker inside the existing native card.

## Slash Commands

```text
/presence set Sophie 4-46
/presence unset Sophie last 20
/presence resync
/hide Sophie 4-46
/unhide "Sophie Valentine" all
```

`/presence resync` rebuilds native per-character Hide From AI IDs from each message's positive Presence record. For older messages without a positive record, it adopts their current native per-character visibility first. Native `/hide 4-46` and `/unhide last 20` commands pass through untouched.

## Native boundary

Marinara owns agent membership, the agent settings card, message persistence,
and prompt-history filtering through `hiddenFromAICharacterIds`. Mari Bridge
exposes the native pre-save message hook; Presence owns
only the positive attendance record and its projection into those native IDs.
Mari Bridge supplies exact native message/chat persistence events, command
routing, and one package-specific field inside the native agent card. Presence does not
read or modify summaries and does not provide a parallel history or settings
system.
