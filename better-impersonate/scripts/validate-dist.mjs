import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "package");
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "manifest.json"), "utf8"));
const client = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");

assert(manifest.id === "better-impersonate", "package identity is stable");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint is declared");
assert(!manifest.entrypoints?.agents, "no fake agent definition is shipped");
assert(!fs.existsSync(path.join(packageRoot, "agents.json")), "distribution contains no agents.json marker");
assert(JSON.stringify(manifest.contributions?.slots) === JSON.stringify(["chat-runtime"]), "only chat runtime is extended");
assert(client.includes('command: "/impersonate_draft"'), "underscore draft command is registered");
assert(client.includes('command: "/impersonate_continue"'), "underscore continue command is registered");
assert(client.includes('commands: ["/impersonate_last"]'), "underscore last-guidance command is registered");
assert(!client.includes("/impersonate_thinking"), "removed thinking mode is absent");
assert(client.includes("lastGeneratedDraft"), "generated output is tracked separately from guidance");
assert(!client.includes("/impersonate-draft"), "non-native hyphen aliases are absent");
assert(client.includes('"generation.draft"'), "native dry-run generation is used");
assert(client.includes('"commands.draft-write"'), "native draft writing is used");
assert(client.includes('"quick-replies.input-macro"'), "bridge Quick Reply input macros remain enabled");
assert(!client.includes("/api/connections"), "package does not implement connection resolution");
assert(!client.includes("/api/generate/dryRun"), "package delegates dry-run transport to the bridge");
assert(!client.includes("mari-editor-shell"), "package does not replace native settings UI");
assert(!client.includes("MutationObserver"), "package does not observe or rewrite the DOM");

function assert(condition, message) {
  if (!condition) throw new Error(`Dist validation failed: ${message}`);
}

console.log("Better Impersonate thin client distribution validated.");
