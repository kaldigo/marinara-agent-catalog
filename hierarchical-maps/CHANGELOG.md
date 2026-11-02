# Changes

## 1.5.4

- Sync Maps to native World State location in one direction using the complete
  hierarchy joined with `, `.
- Keep tracker location edits/output from moving the map, including Game tracker guidance.
- Preserve other tracker fields and honor Roleplay location locks.
- Reconcile moves, narrated moves, selected swipes, startup and late tracker output.
- Verify against the official World State agent, including conflicting location output.

## 1.5.3

- Publish as World Maps under the existing `hierarchical-maps` identity, replacing
  the official entry in this catalogue rather than adding a second listing.
- Retain upstream's 1.5 major/minor and bump its patch so existing 1.5.2 installations can update.
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
