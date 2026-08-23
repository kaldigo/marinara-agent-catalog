# Group Sort Order

Group Sort Order is a package-era replacement for the legacy Group Smart Order extension.

It replaces only Marinara's native smart group-speaker selection decision. Marinara
continues to own the response queue, generation request, saved messages, retries,
and normal fallback behavior.

Add Group Sort Order to a Roleplay chat and select Smart or Individual response
order. When Marinara needs the next character, Mari Bridge delegates that one
choice to the package. If the package is unavailable, disabled for the chat, or
returns no valid character, Marinara's native selector runs unchanged.

The package is a normal native agent definition. Marinara's standard agent editor
owns its connection/model selection, generation settings, and editable selector
prompt. The selector returns a JSON array of character IDs; it does not add
markers to the main model's prompt or response.

Mari Bridge is required because Marinara 2.4.3 does not expose the native selector
decision as a public package hook.

## Native boundary

The bridge patches only the missing group-selector decision point. The package
does not own group response execution, chat persistence, a separate connection
configuration, or a replacement agent settings page. Any future selector
options should be represented through the normal agent definition and native
agent editor unless Marinara lacks a specific field.
