# Better Impersonate

`better-impersonate` replaces the legacy `impersonate-button` package identity now that the feature is a command-driven impersonation workflow rather than an injected button.

System Quick Replies can now keep the UI configuration while the command owns the behavior:

- `/impersonate_draft {{input}}` produces a persistent editable draft without posting a message.
- `/impersonate_continue {{input}}` continues the persona draft currently in the composer.
- `/impersonate_last` restores the last non-empty guidance into the composer without generating.

Native `/impersonate` and `/imp` remain owned by Marinara and are not modified. Active persona draft runs use Marinara's normal Stop button. Runs and partial output are owned per chat by Mari Bridge, so changing chats or opening another screen no longer detaches the result from the mounted textarea. The package fails closed when Mari Bridge or its command, draft, and Quick Reply hooks are unavailable.

Better Impersonate has no per-chat agent entry or replacement settings page. Its dry runs use Marinara's native global Impersonate prompt, connection/model, preset, and agent-blocking settings. Guidance uses Marinara's native generation-guide channel. Continue sends the existing composer draft as a provider-level continuation prefill and receives only the generated continuation. Mari Bridge resolves the Quick Reply `{{input}}` macro before dispatching the slash command.

Mari Bridge adds a native **Preset handles impersonation** switch beside the existing Impersonate switches. When enabled with a selected Impersonate preset, the preset is treated as the complete impersonation prompt and the normal Impersonate prompt template is omitted. Guidance is still added through the native generation-guide channel, and Continue still uses the existing draft as a provider prefill. With the switch disabled, Draft and Continue retain the normal Impersonate prompt template.

Recall is stored per chat as separate guidance and generated-draft values. Supplying the exact last generated draft to `/impersonate_draft` does not replace the guidance restored by `/impersonate_last`. Successful Continue runs update the remembered generated draft but never replace the remembered guidance.

## Native boundary

Marinara owns impersonation prompt assembly, connection handling, dry-run
generation, streaming, abort behavior, the composer draft store, and the native
Stop button. Better Impersonate owns only the additional commands, their
generation-guide content, guidance/output recall, and Quick Reply dispatch. It must not
introduce a parallel request client, model picker, prompt editor, Stop command,
or replacement settings UI.
