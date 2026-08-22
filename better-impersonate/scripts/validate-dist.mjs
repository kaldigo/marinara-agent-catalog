import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "package");
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "manifest.json"), "utf8"));
const client = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");

assert(manifest.id === "better-impersonate", "manifest id must use the renamed package identity");
assert(manifest.version === "2.3.1", "manifest version must be 2.3.1");
assert(manifest.name === "Better Impersonate", "package uses its expanded feature name");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint must be client.js");
assert(client.includes('const PACKAGE_ID = "better-impersonate"'), "client uses the renamed bridge consumer identity");
assert(client.includes('const TAG_NAME = "marinara-capability-better-impersonate"'), "client uses the renamed capability element");
assert(client.includes("activateClientWithMariBridge"), "client must fail closed through the Mari Bridge SDK");
assert(client.includes('commands: ["/impersonate-draft"]'), "client registers impersonate-draft");
assert(client.includes('commands: ["/impersonate-continue"]'), "client registers impersonate-continue");
assert(client.includes('commands: ["/impersonate-thinking"]'), "client registers impersonate-thinking");
assert(client.includes('commands: ["/impersonate-last"]'), "client registers impersonate-last");
assert(client.includes('aliases: ["/impersonate_draft"]'), "client registers the underscore draft alias");
assert(manifest.contributions?.agentDetail?.agentIds?.includes("better-impersonate"), "manifest contributes Better Impersonate agent detail");
assert(client.includes('slot: "chat.settings"'), "client contributes editable native chat settings");
assert(client.includes("data-bi-setting"), "client exposes command-specific prompt templates");
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

console.log("Better Impersonate dist validation passed.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
