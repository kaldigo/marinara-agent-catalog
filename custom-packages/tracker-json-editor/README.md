# Tracker JSON Editor

Adds a compact JSON button next to each tracker section's rerun button. The button opens a modal containing the JSON patch for that section, ready to copy, edit, replace, and save.

This package uses Marinara's existing game-state endpoints:

- `GET /api/chats/:id/game-state`
- `PATCH /api/chats/:id/game-state`

It is intentionally client-only and exploratory.
