# Changelog

## 3.0.2

- Allow Impersonate with an empty composer, using the native dry run without
  additional direction. Continue still requires a draft; busy-state guards remain.

## 3.0.1

- Place all three actions above the existing native Quick Actions.
- Match native outer controls, icon rings, icon sizing, theme colors and hover/
  disabled states. Explain unavailable actions in titles and disable empty draft
  actions or Restore with no saved guidance.
- Follow the native buttons' rendered entry/exit motion and stagger phases.
- Verify styles against two enabled native actions on Engine 2.5.0, including
  computed appearance, hover, disabled input transitions and recorded motion.

## 3.0.0

- Rewrite as a standalone browser capability package with Impersonate, Continue
  impersonate and Restore previous in the native Quick Actions menu.
- Use unmodified native dry-run impersonation; pass continuation as direction.
- Filter leading reasoning using Marinara's shared parser and strip echoed draft
  prefixes before appending continuations.
- Remove old bridge, injected hooks and slash commands.
- Preserve per-chat guidance recall and provide operation-owned cancellation.
- Verified against Engine 2.5.0 in the maintained testbench and enabled for catalog publication.
- Require an explicit native impersonation preset for random connections in
  Roleplay, so reasoning configuration is known before changing the draft.
