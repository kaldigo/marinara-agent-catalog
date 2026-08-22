import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export function requiresBootstrapHandoff(kernel, bootstrapChanged, implementationVersion) {
  return Boolean(kernel && (bootstrapChanged || kernel.version !== implementationVersion));
}

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
  try {
    await chmod(target, 0o600);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await copyFile(source, target);
  await chmod(target, 0o600);
  return { path: target, changed: true };
}
