// Exercise the shipped overlay preparation against a disposable Engine build.
// No Engine process starts. Only --data and --output are written by this audit.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const split = argument.indexOf("=");
  if (split < 0) throw new Error("Use --name=value arguments");
  return [argument.slice(0, split), argument.slice(split + 1)];
}));
if (!args["--engine"] || !args["--data"] || !args["--output"]) {
  throw new Error("Required: --engine=<disposable-build> --data=<dedicated-audit-directory> --output=<json>");
}
const engineRoot = path.resolve(args["--engine"]);
const dataDir = path.resolve(args["--data"]);
// Refuse an audit directory that could contain/overwrite the Engine build.
const relativeEngine = path.relative(dataDir, engineRoot);
if (!relativeEngine || (!relativeEngine.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeEngine))) {
  throw new Error("Audit data must not contain the Engine checkout");
}
process.env.MARI_BRIDGE_DISABLE = "1";
const { preflightServerPatches } = await import("../bootstrap/runtime.mjs");
const { prepareClientOverlay } = await import("../src/server/client-overlay.js");
const kernel = globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")];
const manifest = JSON.parse(await readFile(path.join(engineRoot, "package.json"), "utf8"));
const serverCompatible = preflightServerPatches(engineRoot);
const report = {
  method: "Shipped preflight against a full Engine build, followed by diagnostic client overlay preparation; no server or browser execution. The production Engine version gate remains unchanged.",
  engine: {
    version: manifest.version,
    commit: execFileSync("git", ["-C", engineRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  },
  bridgeVersion: kernel.version,
  server: { compatible: serverCompatible, patches: { ...kernel.patches }, failures: [...kernel.failures] },
};
try {
  const client = await prepareClientOverlay({
    dataDir, sourceRoot: path.join(engineRoot, "packages", "client", "dist"), engineVersion: manifest.version,
  });
  report.client = { fingerprint: client.fingerprint, patches: client.patches, failedPatches: client.failedPatches };
} catch (error) {
  report.client = { error: error.message };
}
await writeFile(path.resolve(args["--output"]), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!serverCompatible || report.client.error || report.client.failedPatches?.length) process.exitCode = 1;
