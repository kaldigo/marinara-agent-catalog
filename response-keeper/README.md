# Response Keeper

Response Keeper preserves Roleplay and Conversation response variants that Marinara would otherwise overwrite or discard:

- stopped regenerations are saved as swipes when partial text arrived,
- stopped continuations append the partial continuation to the existing active message,
- manual edits create an edited swipe, then consecutive edits to that edited swipe update the same swipe.

Continue generations do not create new swipes.

Game Mode is intentionally ignored because assistant swipes can carry game, spatial, and replay snapshots that should stay owned by the core app.
