# Marinara-Presence

Browser extension for Marinara Engine. The installed extension name is **Presence**.

Presence stores per-message character attendance in `message.extra.marinaraPresence`.
When generation starts, it temporarily hides messages that none of the currently
active chat characters were present for, then restores exactly those messages when
generation completes or fails.

When a message is saved, Presence stamps it with the chat's currently active
characters. Characters listed in chat metadata `inactiveCharacterIds` are excluded.

If Marinara Group Smart Order is installed with Presence compatibility, GSO hands
Presence the final generate body after it chooses `forCharacterId`. Presence still
works without GSO.

## Slash Commands

Presence consumes only commands that start with `/presence`:

```text
/presence set Alice 10-25
/presence unset Bob last 30
/presence set "Alice Liddell" all
/presence unset Charlie from 12 to 40
```

If a message has no presence record, everyone in the current chat roster is treated
as present. Resetting a message to everyone-present stores `marinaraPresence: null`.

`set` marks a character present without removing anyone else. `unset` removes a
character from the selected messages.

## Debug Logging

Debug logging is off by default. In the browser console:

```js
window.__marinaraPresence.setDebug(true)
```

Turn it off again with:

```js
window.__marinaraPresence.setDebug(false)
```

## Build

```text
npm run check
```

Import either `dist/Presence/manifest.json` as a folder package or
`dist/presence.json` as a single extension file.
