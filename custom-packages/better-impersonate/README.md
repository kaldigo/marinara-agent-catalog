# Better Impersonate

`better-impersonate` replaces the legacy `impersonate-button` package identity now that the feature is a command-driven impersonation workflow rather than an injected button.

System Quick Replies can now keep the UI configuration while the command owns the behavior:

- `/impersonate-draft {{input}}` produces a persistent editable draft without posting a message.
- `/impersonate-continue {{input}}` continues the persona draft currently in the composer.
- `/impersonate-thinking {{input}}` treats the composer text as private thoughts and feelings.
- `/impersonate-last` restores the last non-empty draft or thinking guidance into the composer without generating.

Native `/impersonate` and `/imp` remain owned by Marinara and are not modified. Active persona draft runs use Marinara's normal Stop button. Runs and partial output are owned per chat by Mari Bridge, so changing chats or opening another screen no longer detaches the result from the mounted textarea. The package fails closed when Mari Bridge or its command, draft, and Quick Reply hooks are unavailable.

Chat Settings exposes global Draft, Continue, and Private Thinking templates. They wrap Marinara's native impersonate prompt and support `{{base_prompt}}`, `{{user}}`, and `{{impersonate_direction}}`. Connection/model, preset, and agent-blocking choices remain in Marinara's native Impersonate section. Mari Bridge resolves the Quick Reply `{{input}}` macro before dispatching the slash command.
