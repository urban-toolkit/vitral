import { readFile } from "fs/promises";
import path from "path";

const cache = new Map<string, string>();

export async function loadPrompt(name: string): Promise<string> {
  if (cache.has(name)) {
    return cache.get(name)!;
  }

  const filePath = path.join(
    process.cwd(),
    "src",
    "prompts",
    `${name}.txt`
  );

  const content = await readFile(filePath, "utf-8");
  cache.set(name, content);

  return content;
}
