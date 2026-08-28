# GM Notes

GM Notes is a focused post-processing tracker agent with two small native UI
extensions. The agent maintains only durable reminders, unresolved threads, and
continuity diagnostics in the exact GameState snapshot for each assistant
message and swipe.

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
package-owned replacement settings page. Its default temperature is zero so the
structured maintenance pass stays consistent.

## Historical backfill

After installing or re-enabling GM Notes in an existing Roleplay chat, use the
history button in its Tracker section or HUD popover to catch up. Backfill reads
only completed turns through the latest assistant message and processes them in
small chronological batches. It uses the GM Notes agent's configured connection
and model, applies each completed batch to the latest GameState, and checkpoints
progress in package storage.

Backfill can be stopped and run again without losing completed batches. It also
pauses when normal generation begins, avoiding competing writes with Marinara's
ordinary agent lifecycle. Manual notes, locked notes, and notes originating
after the batch being processed cannot be changed or removed by backfill. Normal
future turns continue through Marinara's native post-processing agent runner;
the package route exists only for this explicit historical catch-up operation.

## Focus policy

GM Notes is a continuity ledger, not a general memory store or scene summary.
The default prompt keeps a note only when forgetting it could plausibly make a
later response wrong or incomplete:

- reminders cover durable narration rules, knowledge boundaries, promises, and
  exceptional facts not owned by a native tracker;
- threads cover specific unresolved setups and future payoffs;
- diagnostics cover actual contradictions or facts that require verification.

Routine events, transient mood or position, ordinary tracker facts, and vague
atmosphere stay out. The three kinds are grouped and labelled explicitly in
committed prompt context so the main model can distinguish instructions, open
work, and facts that are not yet safe to assume.

## State and result handling

The agent returns structured `gm_notes_updates`. Mari Bridge contributes the
missing result-type handler and tracker-context formatter; Marinara's normal
agent runner still performs the model call.

Notes are stored in the native GameState snapshot under the GM Notes package
namespace. Manual changes update that same state and preserve unrelated native
and package-owned GameState fields. Stored notes are included in Marinara's
committed tracker context for subsequent generations.

The prompt asks the agent to keep each note concise, make the minimum necessary
updates, and remove clearly resolved or obsolete entries. There is no
prompt-level or deterministic storage cap. The result applier and manual editor
preserve every valid note.

## Native UI extensions

Mari Bridge supplies only the two placements Marinara does not expose to normal
agents:

- a GM Notes section in the docked Tracker panel, based on the native Custom
  Tracker and Quest Board interaction patterns;
- a compact Roleplay HUD item, based on the native tracker and quest HUD
  patterns.

For the docked panel, Mari Bridge owns the direct native section element,
`SectionHeader`, persisted collapse control, active-agent gating, edit-mode
props, placement immediately before Custom Tracker, and native rerun action.
GM Notes supplies only its note rows and mutations. The UI follows native
tracker behavior rather than a package-specific form:

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

The native Agent Suite displays the current GM Notes array as Tracker Data.
Agent Suite owns its normal JSON editor, Save/Reset, dirty-state guard, AI Edit,
and refresh behavior; GM Notes supplies only its state reader, validation, and a
merge-safe GameState patch that preserves other package namespaces.

Mari Bridge is required for the result/context hooks and these native UI slots.
If the required capabilities are unavailable, GM Notes fails closed instead of
falling back to DOM listeners or a parallel implementation.

## Upgrading

Version 1.1.0 keeps the original `gm-notes` package ID, result type, GameState
namespace, and schema version. Notes created by 1.0.x remain readable,
including their stable IDs, source stamps, and lock state.
