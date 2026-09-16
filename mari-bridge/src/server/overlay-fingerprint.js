import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Hash the copied files, including names: same-version Engine rebuilds are distinct. */
export async function fingerprintOverlayInputs(roots, extra = []) {
  const hash = createHash("sha256");
  async function visit(root, relative = "") {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(root, name);
      else if (entry.isFile()) {
        hash.update(name).update("\0").update(await readFile(join(root, name))).update("\0");
      } else throw new Error(`Mari Bridge cannot fingerprint a non-regular overlay input: ${name}`);
    }
  }
  for (const root of roots) {
    hash.update("tree\0");
    await visit(root);
  }
  for (const value of extra) hash.update("extra\0").update(value).update("\0");
  return hash.digest("hex");
}
