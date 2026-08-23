# PWA Helper

PWA Helper is a client-side Marinara capability package.

Current features:

- Holds the Screen Wake Lock while the installed Mari Bridge runtime reports active main or agent generation.
- Exposes a small `window.marinaraPwaHelper.wakeLock` surface so other client packages can hold the same wake lock without duplicating wake-lock code.
- Installs an iOS `apple-touch-icon` override using Marinara's logo on the current Mari gradient background.

The package consumes Mari Bridge generation lifecycle events through the bundled thin `_mari-bridge` SDK and keeps wake-lock handling, status reporting, its public `window.marinaraPwaHelper` API, and iOS icon behavior package-local.

## Native boundary

Mari Bridge supplies only the generation lifecycle signal that Marinara does
not publish to packages. PWA Helper does not infer generation from DOM buttons,
intercept requests, replace native generation controls, or add chat-level agent
settings. The wake lock and iOS metadata behavior remain isolated client-side
effects.
