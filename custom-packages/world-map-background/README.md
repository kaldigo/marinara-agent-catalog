# World Map Background

World Map Background is a Roleplay feature agent that mirrors the current World Maps location reference image into the chat background.

Add the agent to a Roleplay chat alongside World Maps. When the current World Maps location has `useReferenceImage` enabled and a reference image selected, this package resolves the image from the chat or global gallery and writes it to Marinara's native chat background metadata. Marinara's existing Roleplay background component renders it.

If the agent is removed or the current location has no usable reference image, the package restores the background value that was present before it took ownership.

The native agent card contains one package-specific per-chat control: background blur. Fit, position, opacity, rendering, and agent enable/disable remain native Marinara behavior.

The client reconciles from Mari Bridge active-chat and generation lifecycle events and from World Maps spatial-state events. It does not poll, scan the DOM, create a second background overlay, or validate media through hidden image elements.

## Native boundary

Marinara owns the agent card, chat metadata, gallery assets, and Roleplay
background renderer. World Maps owns the active location and reference-image
choice. This package only translates that choice into Marinara's native
background metadata and contributes the one missing blur field to its existing
native agent card. Mari Bridge supplies lifecycle and `agent.settings` seams;
it does not supply a replacement background or settings system.
