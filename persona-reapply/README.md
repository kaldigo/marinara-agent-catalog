# Persona Reapply

Persona Reapply refreshes the saved persona colours attached to historical user messages.

## Usage

- Use the persona button in a user message's action bar to refresh that message.
- Type `/reapply-persona` to refresh all user messages in the current chat. The command asks for confirmation before changing the chat.

Messages that already have a persona snapshot are refreshed from that snapshot's persona ID, so chats that used multiple personas retain the correct identity. Messages created before persona snapshots existed fall back to the persona currently selected for the chat.

Only the display colour fields are changed:

- Name colour
- Dialogue highlight colour
- Message-box colour

Names, avatars, crops, descriptions, and other historical persona fields are not changed.

The package requires a Marinara restart after installation because it includes server routes.
