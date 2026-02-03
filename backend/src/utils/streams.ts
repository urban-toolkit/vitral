import type { Readable } from "node:stream";

export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function streamToString(stream: Readable, encoding: BufferEncoding = "utf8"): Promise<string> {
  const buf = await streamToBuffer(stream);
  return buf.toString(encoding);
}