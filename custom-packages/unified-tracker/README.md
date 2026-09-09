# Unified Tracker

Unified Tracker 1.0 combines selected Roleplay tracker work into one normal
parallel agent and one structured `unified_tracker_update` result. Automatic
runs are skipped during regenerations; explicit reruns remain available.
It reuses Marinara's native generation lifecycle, cadence, model/connection
settings, exact message-and-swipe GameState storage, result applicators, locks,
rerun controls, docked tracker panels, and Roleplay HUD.

Per-chat section toggles control World, Characters + persona scene details,
Character stats, Persona stats, Quests, and GM Notes. World and Characters are
on by default; the two stats sections, Quests, and GM Notes are off. Characters
uses one identity-matched `characters` array containing the active persona,
every saved chat character, and any additional scene-relevant characters.

The package preserves returning-character data, discards locked mood and
appearance changes, routes persona details through the shared Tracker Profile
Details codec, and routes GM Notes through its shared codec. Enabled native
surfaces are virtually activated without adding standalone tracker IDs to the
chat. If an equivalent standalone tracker is also enabled, both remain active
and the settings card shows an overlap warning.

Stored Unified checkpoints can be injected into later main prompts at the
depth of the assistant message and swipe that produced them. Each enabled
section also has an editable per-chat prompt fragment.

See [DESIGN.md](DESIGN.md) for the product contract,
[docs/native-tracker-behavior.md](docs/native-tracker-behavior.md) for the
upstream behavior survey, and
[docs/implementation-deep-dive.md](docs/implementation-deep-dive.md) for the
handler, history, lock, cadence, context, side-effect, and UI trace.
