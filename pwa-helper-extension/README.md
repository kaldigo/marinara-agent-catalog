# PWA Helper

Small client-side Marinara helper extension for PWA/mobile behavior.

## Current feature

- Keeps the screen awake while Marinara appears to be generating.

The extension has two layers:

- PWA Helper watches the visible chat input controls and opens a wake-lock lease when the Send button changes into a Stop generating control.
- The packaged `window.alDenteFactory` shared runtime owns the actual browser Screen Wake Lock API and can also accept wake-lock leases from other extensions.

The wake lock is released when all active leases are released, when generation stops, when the extension is disabled, or when the browser revokes the lock.

Wake lock support depends on the browser and context. It generally requires HTTPS or localhost, a visible tab, and a browser that implements `navigator.wakeLock`.

## Install

Run `npm run build`, then import either:

- `dist/Marinara-PWA-Helper/`
- `dist/pwa-helper.json`

from **Settings -> Extensions**.
