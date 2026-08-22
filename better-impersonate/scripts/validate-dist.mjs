import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "package");
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "manifest.json"), "utf8"));
const client = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");

assert(manifest.id === "better-impersonate", "manifest id must use the renamed package identity");
assert(manifest.version === "2.3.5", "manifest version must be 2.3.5");
assert(manifest.name === "Better Impersonate", "package uses its expanded feature name");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint must be client.js");
assert(manifest.entrypoints?.agents === "agents.json", "agents entrypoint must be agents.json");
assert(!manifest.contributions?.slots?.includes("chat-settings"), "Better Impersonate must not add chat-level settings");
assert(client.includes('const PACKAGE_ID = "better-impersonate"'), "client uses the renamed bridge consumer identity");
assert(client.includes('const TAG_NAME = "marinara-capability-better-impersonate"'), "client uses the renamed capability element");
assert(client.includes("activateClientWithMariBridge"), "client must fail closed through the Mari Bridge SDK");
assert(
  client.indexOf("defineCapabilityElement();") < client.indexOf("cleanupImpersonateCommands = await activateClientWithMariBridge("),
  "client must register the capability element before bridge activation can fail",
);
assert(client.includes('commands: ["/impersonate_draft"]'), "client registers impersonate_draft");
assert(client.includes('commands: ["/impersonate_continue"]'), "client registers impersonate_continue");
assert(client.includes('commands: ["/impersonate_thinking"]'), "client registers impersonate_thinking");
assert(client.includes('commands: ["/impersonate_last"]'), "client registers impersonate_last");
assert(client.includes('aliases: ["/impersonate-draft"]'), "client retains the hyphenated draft alias");
assert(manifest.contributions?.agentDetail?.agentIds?.includes("better-impersonate"), "manifest contributes Better Impersonate agent detail");
assert(!client.includes('slot: "chat.settings"'), "client does not contribute chat-level settings");
assert(!client.includes('"ui.chat-settings"'), "client does not require the chat-settings bridge capability");
assert(client.includes("mari-editor-shell"), "client uses the native editor/detail shell for global settings");
assert(client.includes("setMariBridgeNativeSettingsHtml"), "client uses the bridge-owned native settings renderer");
assert(client.includes("data-bi-setting"), "client exposes command-specific prompt templates");
assert(client.includes("/api/agents/type/"), "client persists prompt settings through Marinara's global agent settings API");
assert(!client.includes("mari-better-impersonate-settings:v1"), "client must not store global prompt templates in browser localStorage");
assert(!client.includes('hijacks: ["/impersonate"'), "client leaves native impersonation commands untouched");
assert(client.includes('"quick-replies.input-macro"'), "client requires Quick Reply input macro support");
assert(client.includes('"commands.draft-write"'), "client requires native draft writing");
assert(client.includes('"generation.draft"'), "client requires bridge-owned dry-run generation");
assert(!client.includes('commands: ["/stop-draft"]'), "client uses Marinara's native Stop control");
assert(client.includes("Continue {{user}}'s current in-character draft."), "client includes the continue prompt");
assert(client.includes("Private inner state for {{user}}:"), "client includes the inner-state prompt");
assert(!client.includes("MutationObserver"), "client does not inject composer buttons through DOM observation");
assert(!client.includes("registerComposerSlotContribution"), "client does not mount the legacy quick-action UI");
assert(!client.includes("_mari-bridge/src"), "client does not bundle the legacy bridge implementation");
assert(!client.includes("context.generate("), "client does not persist impersonation as a normal user message");

const filePaths = new Set((manifest.files ?? []).map((file) => file.path));
for (const entrypoint of Object.values(manifest.entrypoints ?? {})) {
  assert(filePaths.has(entrypoint), `manifest files include entrypoint ${entrypoint}`);
}

console.log("Better Impersonate dist validation passed.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
