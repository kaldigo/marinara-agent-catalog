# Better Impersonate 3.0

Browser-only capability package. Adds three actions to Marinara's existing Quick
Actions / Quick Replies menu:

- **Impersonate** uses composer text as direction for a native impersonation dry
  run and places the generated response in the composer without posting it.
- **Continue impersonate** asks the same native endpoint to continue the current
  draft, then appends only new text. A repeated leading draft is removed; matching
  text elsewhere is preserved.
- **Restore previous** restores the chat's last non-empty saved guidance.
  Continue does not overwrite it. Recall from the preceding package is retained.

Enable the native Quick Replies menu with at least two native actions so Marinara
renders its menu (one action is rendered by Engine as a direct button). The package
extends that menu; it does not create another launcher or change user settings.

Native impersonation prompt, preset and connection settings are read afresh for
each operation. Continue supplies direction, not a rewritten prompt or provider
prefill. Native dryRun remains unchanged. This package never posts a chat message.

The upstream inline-thinking stream filter removes leading reasoning before draft
insertion, including supported custom tags from the selected preset. Separate
provider reasoning channels are not inserted. Reasoning-only output preserves the
original input. Exact repeated draft prefixes (also ignoring surrounding draft
whitespace) are removed only at the beginning.

## Lifecycle and DOM boundary

DOM integration was explicitly authorized for this rewrite. Verified Engine 2.5.0
markers: textarea[data-chat-composer][data-chat-id], .mari-chat-input,
.mari-chat-send-btn, and [data-chat-input-popup="quick-reply"] [role="menu"].

The actions sit above the native actions and use the same outer control and inner
icon-ring classes, including hover, focus and disabled states. Impersonate allows
empty input. Continue requires a draft; Restore requires saved guidance for this chat.
All three disable while the composer is busy. Titles explain disabled states.
While a menu is mounted, its captured native buttons supply the rendered spring,
blur and opacity values to the added actions across the native stagger phases.
The native rail owns entry/exit timing and removal; no independent timer or
replacement animation library is involved. This is a DOM integration dependency.

The menu has keyboard navigation and viewport clamping. A filtered
structure observer handles mounting without repeatedly scanning chat messages.
No private React/Zustand access, Engine patch, old bridge, model picker, prompt
editor, slash command or additional generation route is used.

Before generation, the package verifies installation, chat and output-filter
configuration. While running, the composer is read-only and a temporary Stop
control occupies Send's position; it aborts this dry run, never clicks native Stop.
Chat changes/unmounts cancel. Every output write verifies the originating composer
and its expected value. Partial visible output remains on Stop/error; original
guidance remains when no visible output arrived.

The runtime owns all listeners, nodes and observers. Re-evaluation disposes the
previous runtime. For explicit local teardown:
window[Symbol.for("marinara.better-impersonate.runtime")].dispose()
Engine's client loader does not expose an uninstall callback: reload after
uninstall. Each new generation checks installation before changing the draft.

## Build and checks

npm run check builds a prepared client package and runs behavior/transport checks.
npm run check:browser exercises the generated bundle in the maintained Engine
2.5.0 testbench with isolated data and a deterministic model stub. Acquire the
testbench lease first. Desktop/mobile placement, generation, continuation, Stop,
failure cleanup, native chat switching, recall persistence and teardown passed.

Catalog publication is enabled for this verified 3.0.0 release.
The DOM markers and persisted UI settings format are undocumented integration
dependencies. For a random connection in Roleplay, select an explicit impersonation
preset in native settings. The endpoint does not report its selected preset, so
preflight otherwise stops before modifying the draft rather than risking insertion
of custom reasoning tags. No ZIPs, checksums or catalog files are published manually.
