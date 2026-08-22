# GM Notes

GM Notes is a Mari Bridge tracker package. Its post-processing agent maintains
reminders, unresolved threads, and diagnostic notes in the exact GameState
snapshot for each assistant message and swipe.

The stored notes are included inside Marinara's committed tracker context and
shown in the docked Tracker panel and Roleplay HUD. Mari Bridge is required.

## Agent settings

GM Notes uses Marinara's standard tracker-agent editor. The agent exposes a
connection override for selecting a model, context size, maximum output tokens,
prompt-section injection, an editable prompt template with named alternatives,
and tool selection. Leaving the connection override empty uses the chat
connection. Leaving the prompt override empty uses the package's built-in GM
Notes prompt. The package defaults its inputs to chat history and tracker data,
which are the two context sources needed for note maintenance.
