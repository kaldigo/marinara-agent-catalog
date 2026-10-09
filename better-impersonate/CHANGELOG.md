# Changelog

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
