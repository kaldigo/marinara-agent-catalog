// Read-only source audit: transpile the exact Git revision and exercise the
// shipped server transforms without loading Engine code or starting an overlay.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const split = argument.indexOf("=");
  if (split < 0) throw new Error("Use --name=value arguments");
  return [argument.slice(0, split), argument.slice(split + 1)];
}));
if (!args["--engine"] || !args["--typescript"]) {
  throw new Error("Required: --engine=<checkout> --typescript=<typescript.js>; optional: --ref=HEAD --output=<json>");
}
const engineRoot = path.resolve(args["--engine"]);
const ref = args["--ref"] ?? "HEAD";
const git = (...values) => execFileSync("git", ["-C", engineRoot, ...values], {
  encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
});
const ts = (await import(pathToFileURL(path.resolve(args["--typescript"])).href)).default;
const bridgeSource = await readFile(new URL("../bootstrap/runtime.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("runtime.mjs", bridgeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let targetArray;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "SERVER_PATCH_TARGETS") {
    targetArray = node.initializer.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!targetArray || !ts.isArrayLiteralExpression(targetArray)) throw new Error("Patch target table not found");
const targets = targetArray.elements.map((entry) => ({
  label: entry.elements[0].text,
  distPath: entry.elements[1].elements.map((element) => element.text).join("/"),
}));

// Must precede dynamic import: importing the bootstrap with a compatible cwd
// would otherwise prepare an overlay and hand off to an Engine process.
process.env.MARI_BRIDGE_DISABLE = "1";
const { patchServerModule, SUPPORTED_ENGINE_VERSIONS } = await import("../bootstrap/runtime.mjs");
const kernel = globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")];
const commit = git("rev-parse", `${ref}^{commit}`).trim();
const manifest = JSON.parse(git("show", `${commit}:package.json`));
const modules = [];
for (const { label, distPath } of targets) {
  kernel.patches = {};
  kernel.failures = [];
  const sourcePath = distPath.replace("/dist/", "/src/").replace(/\.js$/u, ".ts");
  let record = { label, sourcePath };
  try {
    const source = git("show", `${commit}:${sourcePath}`);
    const emitted = ts.transpileModule(source, {
      fileName: sourcePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        isolatedModules: true, esModuleInterop: true,
        rewriteRelativeImportExtensions: true, newLine: ts.NewLineKind.LineFeed,
      },
    }).outputText;
    const patched = patchServerModule(pathToFileURL(path.join(engineRoot, distPath)).href, emitted);
    const parsed = ts.createSourceFile(label, patched, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    record = {
      ...record,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      patches: { ...kernel.patches }, failures: [...kernel.failures],
      syntaxErrors: parsed.parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    };
  } catch (error) {
    record.error = error.message;
  }
  modules.push(record);
}
const patches = modules.flatMap((module) => Object.entries(module.patches ?? {}));
const report = {
  method: "TypeScript single-file emission and Bridge server transforms only; no Engine execution, type-check, client bundle build, or live verification.",
  engine: { version: manifest.version, ref, commit },
  bridge: { version: kernel.version, supportedEngineVersions: SUPPORTED_ENGINE_VERSIONS },
  compilerVersion: ts.version,
  summary: {
    targetModules: modules.length,
    passingModules: modules.filter((module) => !module.error && !module.failures.length && !module.syntaxErrors.length).length,
    appliedPatchIds: new Set(patches.filter(([, status]) => status === "applied").map(([id]) => id)).size,
    failedPatchIds: new Set(patches.filter(([, status]) => status === "failed").map(([id]) => id)).size,
    moduleErrors: modules.filter((module) => module.error).length,
    modulesWithSyntaxErrors: modules.filter((module) => module.syntaxErrors?.length).length,
  },
  modules,
};
if (args["--output"]) await writeFile(path.resolve(args["--output"]), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ engine: report.engine, summary: report.summary }, null, 2));
for (const module of modules) {
  for (const failure of module.failures ?? []) console.log(`${module.label}: ${failure}`);
  if (module.error) console.log(`${module.label}: ${module.error}`);
}
if (report.summary.failedPatchIds || report.summary.moduleErrors || report.summary.modulesWithSyntaxErrors) process.exitCode = 1;
