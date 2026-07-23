# Migration From Presence Extension

The legacy extension stores message presence under:

```text
message.extra.marinaraPresence
```

The package rewrite stores metadata under:

```text
message.extra.marinaraPresencePackage
```

## Migration Steps

1. Load the active chat roster and messages.
2. Skip chats with a migration marker at the current migration version.
3. For each message:
   - If package metadata already exists, leave it alone.
   - If extension metadata exists, convert `presentCharacterIds`.
   - If old state used names, resolve exact roster name matches first.
   - Preserve `hiddenFromAI === true`.
   - Preserve manual `hiddenFromAICharacterIds`.
4. Patch converted messages.
5. Store a per-chat migration marker.

## Ambiguous Characters

Duplicate or unknown character names should not be guessed. Migration should
report unresolved values and leave those message records unchanged until the user
or a later resolver can map them safely.
