# Presence

Presence is a chat-specific tracker feature for per-message character attendance in Marinara Engine Roleplay chats. It only mutates chats where the Presence agent is enabled.

## Message State

Presence uses Marinara's native `message.extra.hiddenFromAICharacterIds` field as its only per-message source of truth. It does not maintain a second positive attendance record. Globally hidden messages remain globally hidden.

## Lifecycle

- Existing messages are left unchanged when Presence is first enabled.
- Post-only and generation-created messages are stamped with the active roster through Mari Bridge's native pre-save message hook.
- Regenerate and continue preserve the message's existing native visibility. The post-persistence callback only restores access for configured omnipresent characters.
- A monotonic chat-level known-character set detects genuinely new members. New characters are backfilled as hidden on historical messages, while removing and later re-adding a known character does not erase their earlier access.

## Always Present

The native Presence agent card includes a Mari Bridge avatar picker for characters that should always be present. This is intended for narrator and system-style cards. Selecting one removes only that character from existing per-character hidden lists and includes them in future messages even while inactive. Deselecting affects future messages only; use a scoped hide command for retroactive changes.

Omnipresent settings are updated atomically under Marinara's native chat lock and remain configured if a character temporarily leaves the roster.

The package does not replace Marinara's agent editor or settings layout. Mari Bridge contributes only this package-specific picker inside the existing native card.

## Slash Commands

```text
/presence set Sophie 4-46
/presence unset Sophie last 20
/presence resync
/hide Sophie 4-46
/unhide "Sophie Valentine" all
```

`/presence resync` backfills genuinely new characters and removes configured omnipresent characters from native per-character hidden lists. Native `/hide 4-46` and `/unhide last 20` commands pass through untouched.

## Native boundary

Marinara owns agent membership, the agent settings card, message persistence,
and prompt-history filtering through `hiddenFromAICharacterIds`. Mari Bridge
exposes the native pre-save message hook; Presence owns
only targeted updates to those native IDs and its chat-level known/omnipresent configuration.
Mari Bridge supplies exact native message/chat persistence events, command
routing, and one package-specific field inside the native agent card. Presence does not
read or modify summaries and does not provide a parallel history or settings
system.
