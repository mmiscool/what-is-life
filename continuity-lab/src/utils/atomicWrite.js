import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function atomicWrite(filePath, contents) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, filePath);
}

export async function atomicWriteJson(filePath, value) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
