# Migration: World Map Background

Temporary migration note: delete this file once the work and verification below are complete.

Keep catalog distribution and use native World Maps and chat-background behavior. Prefer a browser-only capability package if current native APIs expose the required state, changes and background application; otherwise retain only the server code actually needed.

Remove the old bridge's spatial, active-chat, background and generation dependencies. Trace native location-change notifications, reference-image resolution, persistence and background restoration before implementing replacements. Do not substitute DOM scans, private stores or polling for a missing integration.

Use the shared bootstrap and registry for reusable native-backed actions. Resolve/preflight every required dependency before operation side effects; never retain provider implementations at initialization. Keep asynchronous results bound to the originating chat and location.

Verify location changes, missing images, blur/settings, chat switching while requests run, background restoration, reload persistence, disable/unload and provider replacement. Re-enable publication only after migration checks pass; current source still requires the archived bridge.
