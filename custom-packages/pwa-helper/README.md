# PWA Helper

PWA Helper is a client-side Marinara capability package.

Current features:

- Holds the Screen Wake Lock while Marinara generation appears active in the chat input.
- Exposes a small `window.marinaraPwaHelper.wakeLock` surface so other client packages can hold the same wake lock without duplicating wake-lock code.
- Installs an iOS `apple-touch-icon` override using Marinara's logo on the current Mari gradient background.

The package prefers package-era browser behavior and avoids Marinara internals where possible. Generation start detection still relies on the visible Stop/send button because current Marinara client events expose completion/error events, not a stable generation-start event.
