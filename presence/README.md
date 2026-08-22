# Presence

Presence is a tracker-category feature agent for per-message character attendance in Marinara Engine Roleplay and Visual Novel chats. It only mutates chats where the Presence tracker is enabled.

## Message State

Presence stores an explicit positive attendance record in `message.extra.marinaraPresence.presentCharacterIds`. It also projects that record into Marinara's native `message.extra.hiddenFromAICharacterIds` field so prompt history is scoped by the engine itself.

The positive record remains authoritative when the roster changes. A character added later is absent from older messages unless their ID was already recorded as present. Globally hidden messages remain globally hidden.

## Lifecycle

- Existing messages are initialized when Presence is first enabled, and older package-era chats adopt their native per-character visibility when positive records are missing.
- Post-only and generation-created messages are stamped with the active roster.
- Generated user messages are stamped as soon as their row appears, with generation completion retained as a fallback.
- Newly added characters are hidden from historical messages using the stored positive attendance records.
- Regenerate and continue preserve existing attendance instead of replacing it with the current active roster.

## Always Present

Chat Settings and the Presence agent detail view include the shared Mari Bridge avatar picker for characters that should always be present. This is intended for narrator and system-style cards. Selecting one updates existing non-globally-hidden messages and includes that character in future stamps even while inactive.

## Slash Commands

```text
/presence set Sophie 4-46
/presence unset Sophie last 20
/presence resync
/hide Sophie 4-46
/unhide "Sophie Valentine" all
```

`/presence resync` rebuilds native per-character Hide From AI IDs from each message's positive Presence record. For older messages without a positive record, it adopts their current native per-character visibility first. Native `/hide 4-46` and `/unhide last 20` commands pass through untouched.
