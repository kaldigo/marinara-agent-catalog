# World Map Background

World Map Background is a Roleplay feature agent that mirrors the current World Maps location reference image into the chat background.

Add the agent to a Roleplay chat alongside World Maps. When the current World Maps location has `useReferenceImage` enabled and a reference image selected, this package resolves the image from the chat or global gallery, writes it to chat background metadata, and mirrors it into the open Roleplay surface.

If the agent is removed or the current location has no usable reference image, the package removes its live overlay and restores the background value that was present before the package took ownership.

The client reconciles immediately after World Maps commits or refreshes spatial state, again when generation settles, and periodically while the chat is open. It verifies that the resolved image actually loads before persisting it, and removes failed image elements so transient media errors are retried instead of leaving a permanently black background.
