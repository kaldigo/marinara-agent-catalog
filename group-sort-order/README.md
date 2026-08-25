# Group Sort Order

Group Sort Order tracks one next participant across Roleplay group turns. The
participant can be an active character or the current persona.

During an ordinary character response, the package contributes a short terminal
handoff instruction through Mari Bridge's native prompt hook. The model appends a
`<next_speaker>` marker. Mari Bridge withholds that marker from streamed text,
removes it before the message is saved, validates it through this package, and
anchors the selection to the generated message and active swipe.

The Bridge-owned composer bar displays the selected participant. Its persona
control includes or excludes the persona from the candidate pool; the persona is
included by default. Refresh runs the package's fallback selector through the
normal Agent connection when the main response did not provide a valid marker.

When a stored character is next, Mari Bridge supplies that character to
Marinara's native Individual response queue. When the persona is next, the
generation ends without queueing an assistant and the bar shows **Your turn**.
A newly submitted user message consumes that handoff and lets Marinara choose the
next responding character normally.

## Native boundary

Marinara continues to own prompt assembly, model execution, response streaming,
message persistence, swipes, the response queue, and composer placement. Mari
Bridge owns the missing package-neutral handoff hooks and native composer control.
This package owns only participants, per-chat persona inclusion, anchored
selection state, prompt wording, marker validation, and fallback selection.

There is no package client, DOM scan, polling loop, generation wrapper route, or
package-owned settings page.
