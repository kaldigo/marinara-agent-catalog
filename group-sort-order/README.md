# Group Sort Order

Group Sort Order is a package-era replacement for the legacy Group Smart Order extension.

It injects an inspectable prompt marker instruction through Marinara's generation-time agent injection override path, asks the main response model to append a terminal `<next_speaker>id</next_speaker>` tag, records the parsed next speaker per message/swipe, then strips the tag from saved message content.

The package only directs `/api/generate` when a valid next speaker is already known. It does not call a selector model automatically; the Refresh button uses `/api/generate/raw` to run a Smart-style selector against the main chat connection. If the selector returns no valid speaker, the preview becomes Unknown.

Until Marinara exposes a first-class package prompt-contribution API with durable chat scope and depth controls, the package uses `_mari-bridge` to append a request-time agent injection override.

The package exposes bridge-cache inspection routes under `/api/group-sort-order/prompt-contributions/:chatId`. A cached contribution can be set or cleared for any `agentType`; cached entries are applied on the next generation unless a live contributor replaces or clears that same `agentType`.
