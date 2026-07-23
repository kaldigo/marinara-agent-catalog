# Marinara Custom Agents

This branch contains custom prompt-agent sources.

Each root folder is one source unit. Add a `marinara-source.json` file with
`"type": "custom-agents"` and an `agents.json` file containing prompt-agent
definitions. The generated `main` branch combines included folders into a
single top-level `agents.json` so Marinara can install it as a custom agent
repository.

Custom agents here cannot use `execution: "feature"`. Anything that needs
client/server/package runtime belongs on the `packages` branch.

