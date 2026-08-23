# GM Notes

GM Notes is a normal post-processing tracker agent with two small native UI
extensions. The agent maintains reminders, unresolved threads, and diagnostic
notes in the exact GameState snapshot for each assistant message and swipe.

Marinara continues to own agent enablement, scheduling, connection/model
selection, generation, retries, prompt editing, and the standard agent settings
screen. GM Notes does not reconstruct those workflows in package code.

## Native agent settings

GM Notes uses Marinara's standard tracker-agent editor. The agent exposes the
same native connection override, context size, maximum output tokens, prompt
section injection, prompt-template editor and alternatives, and tool selection
as other tracker agents. Leaving the connection override empty uses the chat
connection. Leaving the prompt override empty uses the package's built-in GM
Notes prompt.

The package defaults its inputs to chat history and tracker data. There is no
package-owned replacement settings page.

## State and result handling

The agent returns structured `gm_notes_updates`. Mari Bridge contributes the
missing result-type handler and tracker-context formatter; Marinara's normal
agent runner still performs the model call.

Notes are stored in the native GameState snapshot under the GM Notes package
namespace. Manual changes update that same state and preserve unrelated native
and package-owned GameState fields. Stored notes are included in Marinara's
committed tracker context for subsequent generations.

The prompt asks the agent to keep the notebook concise and normally maintain no
more than 20 active notes. That is model guidance, not a deterministic storage
cap. The result applier and manual editor preserve valid notes beyond 20 unless
a future product requirement explicitly introduces a hard limit.

## Native UI extensions

Mari Bridge supplies only the two placements Marinara does not expose to normal
agents:

- a GM Notes section in the docked Tracker panel, based on the native Custom
  Tracker and Quest Board interaction patterns;
- a compact Roleplay HUD item, based on the native tracker and quest HUD
  patterns.

The UI follows native tracker behavior rather than a package-specific form:

- click note text to edit it inline;
- enter Add mode to create notes;
- enter Remove mode to remove unlocked notes;
- enter Lock mode to lock or unlock notes;
- cancel or finish a mode without browser alerts, prompts, or confirmation
  dialogs.

Locking is persisted with the note. A locked note cannot be edited or removed
through the UI, and agent-produced update/remove operations for it are ignored.
The HUD remains a compact status surface; detailed management belongs in the
docked panel.

Mari Bridge is required for the result/context hooks and these native UI slots.
If the required capabilities are unavailable, GM Notes fails closed instead of
falling back to DOM listeners or a parallel implementation.
