# Migration: Presence

Temporary migration note: delete this file once the work and verification below are complete.

Keep Presence as a normal capability package, or make it browser-only only if verified native APIs preserve its semantics. Keep catalog distribution. Remove the old bridge dependency without recreating its Engine patches.

Preserve native message.extra.hiddenFromAICharacterIds as the source of truth, existing visibility on regenerate/continue, known-character tracking and configured always-present characters. Preserve unrelated message/chat fields and existing stored data.

The critical feasibility check is atomic pre-save visibility for both posted and generated messages. Trace native persistence hooks and roster changes. A browser-side after-save patch is not equivalent: it can expose incorrect history to generation and race persistence. If no supported hook exists, record that gap rather than claiming parity.

Use the shared bootstrap/registry only for available native-backed services. Preflight dependencies at call start before mutations; keep implementations operation-scoped, with fresh lookup for subsequent calls.

Verify new messages, post-only, regenerate/continue, roster additions/removals/re-additions, always-present settings, historical visibility, reload, concurrent generation and cleanup. Re-enable publication only after migration checks pass; current source still requires the archived bridge.
