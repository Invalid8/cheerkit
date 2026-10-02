import { CheerkitStoreError } from "../server/store.js";

export interface FieldCipher {
  seal(value: string | null): Promise<string | null>;
  open(value: unknown): Promise<string | null>;
}

const prefix = "enc1.";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(
    atob(text.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0),
  );

/**
 * Encrypts supporter text with AES-256-GCM when the host supplies a key (32 random bytes, base64url).
 * Without a key, values are stored as given; any stored ciphertext then fails to open rather than leaking.
 */
export function fieldCipher(encodedKey: unknown): FieldCipher {
  if (encodedKey === undefined) {
    return {
      seal: async (value) => value,
      async open(value) {
        if (value === null || value === undefined) return null;
        if (String(value).startsWith(prefix))
          throw new CheerkitStoreError(
            "STORAGE_FAILURE",
            "Encrypted supporter data needs the encryption key.",
          );
        return String(value);
      },
    };
  }
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw =
      typeof encodedKey === "string"
        ? fromBase64Url(encodedKey)
        : new Uint8Array();
  } catch {
    raw = new Uint8Array();
  }
  if (raw.byteLength !== 32)
    throw new TypeError(
      "The encryption key must be 32 random bytes, base64url-encoded.",
    );
  const key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return {
    async seal(value) {
      if (value === null) return null;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          await key,
          encoder.encode(value),
        ),
      );
      return `${prefix}${toBase64Url(iv)}.${toBase64Url(sealed)}`;
    },
    async open(value) {
      if (value === null || value === undefined) return null;
      const text = String(value);
      if (!text.startsWith(prefix)) return text;
      const [iv, sealed] = text.slice(prefix.length).split(".");
      try {
        return decoder.decode(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: fromBase64Url(iv!) },
            await key,
            fromBase64Url(sealed!),
          ),
        );
      } catch {
        throw new CheerkitStoreError(
          "STORAGE_FAILURE",
          "Encrypted supporter data could not be opened with this key.",
        );
      }
    },
  };
}
