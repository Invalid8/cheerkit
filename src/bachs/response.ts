import type { BachsErrorCode } from "./errors.js";
import { fail } from "./validation.js";

export async function readCheckoutResponse(
  response: Response,
  code: BachsErrorCode = "CHECKOUT_UNCERTAIN",
): Promise<unknown> {
  if (!response.body) fail(code);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1_048_576) {
        await reader.cancel();
        fail(code);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
