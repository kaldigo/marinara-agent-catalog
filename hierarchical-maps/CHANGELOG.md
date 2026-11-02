# Changes

## 1.6.0

- Publish as World Maps under the existing `hierarchical-maps` identity, replacing
  the official entry in this catalogue rather than adding a second listing.
- Advance above upstream 1.5.2 so existing installations can update.
- Install pinned build dependencies in the catalogue build command.

## 1.1.0

- Add opt-in Roleplay location backgrounds using native gallery images and the native background renderer.
- Add per-chat, per-location lore exclusions to the native location inspector.
- Preserve prior enabled flags, ephemeral counters, manual background changes and unrelated metadata.
- Reconcile effects before move-and-reply requests, when movement commits, and after map/chat/swipe mutations.
- Restore temporary overrides and managed backgrounds when Maps is disabled or unloaded.

Engine 2.5.1 integration checks cover actual deterministic generation, narrated
movement, alternate swipes, rejected moves, browser edit/save/reload, disabling
Maps and isolation from another chat. No Engine changes or archived bridge are used.

## 1.0.1

- Separate `${knownLocationsBlock}` from mandatory `${authorityInstruction}`.
- Keep the known-location variable optional in the native turn-template editor.
- Preserve native map storage, travel, linked lore and existing saved templates.
- Advance past Engine's historical `hierarchical-maps@1.0.0` storage blocklist.

Verified with Engine 2.5.1: browser edit/save, reload persistence, restoring the
built-in template, and generation dry runs before and after both changes.
Roleplay and Game prompt contract checks also pass.

Location exclusions and bundled backgrounds remain exploratory, not implemented.
