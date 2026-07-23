# PWA Helper

PWA Helper is a client-side Marinara capability package.

Current features:

- Holds the Screen Wake Lock while `_mari-bridge` reports active main or agent generation.
- Exposes a small `window.marinaraPwaHelper.wakeLock` surface so other client packages can hold the same wake lock without duplicating wake-lock code.
- Installs an iOS `apple-touch-icon` override using Marinara's logo on the current Mari gradient background.

The package consumes `_mari-bridge` generation lifecycle events and keeps wake-lock handling, status reporting, its public `window.marinaraPwaHelper` API, and iOS icon behavior package-local.
