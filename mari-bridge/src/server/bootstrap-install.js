import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

async function sameFileContents(source, target) {
  try {
    const [sourceBytes, targetBytes] = await Promise.all([readFile(source), readFile(target)]);
    return sourceBytes.equals(targetBytes);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function installBootstrapFile(source, target) {
  await mkdir(dirname(target), { recursive: true });
  if (await sameFileContents(source, target)) {
    return { path: target, changed: false };
  }
  await copyFile(source, target);
  return { path: target, changed: true };
}
