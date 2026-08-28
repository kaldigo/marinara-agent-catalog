# Tracker Profile Details

Promotes selected GameState fields into the native docked tracker profile layouts.

- Character `customFields`: Location, Movement, Activity, directly below Outfit.
- Persona `playerStats.customTrackerFields`: Outfit, Location, Movement, Activity, directly below Status.
- Promoted rows keep native edit, lock, and delete-mode behavior.
- The Persona Stats agent contract is extended so it can update the four persona fields.
- When Persona Stats is active, the four promoted persona fields are emitted as Persona Details context and excluded from the native Custom Tracker context section.

The package depends on Mari Bridge 1.0.38 / API 1.9 and Marinara Engine 2.4.4.
