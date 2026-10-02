import type { BachsEnvironment } from "./client.js";
import { rememberAuthenticated } from "./authenticated.js";
import { BachsError } from "./errors.js";
import {
  fail,
  identifier,
  keys,
  object,
  text,
  timestamp,
} from "./validation.js";

export interface BachsWebhookOptions {
  readonly secret: string;
  readonly organizationId: string;
  readonly environment: BachsEnvironment;
  readonly toleranceSeconds?: number;
  readonly maxBodyBytes?: number;
  readonly now?: () => number;
}

export interface BachsSignatureHeaders {
  readonly signatureV2?: string | null;
  readonly signature?: string | null;
  readonly timestamp?: string | null;
}

export interface BachsEvent {
  readonly id: string;
  readonly type: string;
  readonly createdAt: string;
  readonly organizationId: string;
  readonly environment: BachsEnvironment;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface BachsWebhookVerifier {
  readonly organizationId: string;
  readonly environment: BachsEnvironment;
  /** Authenticate original bytes before parsing. Does not deduplicate or reconcile. */
  verify(
    rawBody: Uint8Array,
    headers: BachsSignatureHeaders,
  ): Promise<BachsEvent>;
}

function signatures(headers: BachsSignatureHeaders): {
  time: string;
  digests: string[];
} {
  if (headers.signatureV2 != null) {
    if (
      typeof headers.signatureV2 !== "string" ||
      headers.signatureV2.length > 4096
    )
      fail("INVALID_SIGNATURE");
    const parts = headers.signatureV2
      .split(",")
      .map((part) => part.trim().split("="));
    const times = parts.filter(([key]) => key === "t");
    const digests = parts
      .filter(([key]) => key === "v1")
      .map(([, value]) => value ?? "");
    if (
      parts.some((part) => part.length !== 2) ||
      times.length !== 1 ||
      !digests.length
    )
      fail("INVALID_SIGNATURE");
    return { time: times[0]?.[1] ?? "", digests };
  }
  if (
    typeof headers.timestamp !== "string" ||
    typeof headers.signature !== "string"
  )
    fail("INVALID_SIGNATURE");
  return { time: headers.timestamp, digests: [headers.signature] };
}

function freezeData(value: unknown): void {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
}

export function createBachsWebhookVerifier(
  options: BachsWebhookOptions,
): BachsWebhookVerifier {
  const config = object(options, "INVALID_CONFIGURATION");
  keys(
    config,
    [
      "secret",
      "organizationId",
      "environment",
      "toleranceSeconds",
      "maxBodyBytes",
      "now",
    ],
    "INVALID_CONFIGURATION",
  );
  const secret = text(config.secret, 1024, "INVALID_CONFIGURATION");
  const organizationId = identifier(
    config.organizationId,
    "INVALID_CONFIGURATION",
  );
  const environment = config.environment;
  if (environment !== "sandbox" && environment !== "live")
    fail("INVALID_CONFIGURATION");
  const tolerance = config.toleranceSeconds ?? 300;
  const maxBodyBytes = config.maxBodyBytes ?? 1_048_576;
  for (const [value, max] of [
    [tolerance, 300],
    [maxBodyBytes, 10_485_760],
  ]) {
    if (
      typeof value !== "number" ||
      typeof max !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > max
    )
      fail("INVALID_CONFIGURATION");
  }
  const now = options.now ?? Date.now;
  if (typeof now !== "function") fail("INVALID_CONFIGURATION");
  const encoder = new TextEncoder();
  return Object.freeze({
    organizationId,
    environment,
    async verify(
      rawBody: Uint8Array,
      headers: BachsSignatureHeaders,
    ): Promise<BachsEvent> {
      if (
        !(rawBody instanceof Uint8Array) ||
        rawBody.byteLength > (maxBodyBytes as number)
      )
        fail("INVALID_EVENT");
      object(headers, "INVALID_SIGNATURE");
      const { time, digests } = signatures(headers);
      if (
        !/^[0-9]{1,12}$/.test(time) ||
        digests.some((digest) => !/^[a-fA-F0-9]{64}$/.test(digest))
      ) {
        fail("INVALID_SIGNATURE");
      }
      const clock = now();
      if (
        !Number.isFinite(clock) ||
        Math.abs(clock / 1000 - Number(time)) > (tolerance as number)
      )
        fail("INVALID_SIGNATURE");
      // Copy before awaiting crypto: callers must not be able to change authenticated bytes.
      const bytes = new Uint8Array(rawBody);
      const prefix = encoder.encode(`${time}.`);
      const message = new Uint8Array(prefix.length + bytes.length);
      message.set(prefix);
      message.set(bytes, prefix.length);
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      let valid = false;
      for (const digest of digests) {
        const signature = Uint8Array.from(digest.match(/../g)!, (byte) =>
          Number.parseInt(byte, 16),
        );
        valid =
          (await crypto.subtle.verify("HMAC", key, signature, message)) ||
          valid;
      }
      if (!valid)
        throw new BachsError(
          "INVALID_SIGNATURE",
          "Webhook authentication failed.",
        );
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        return fail("INVALID_EVENT");
      }
      const event = object(payload, "INVALID_EVENT");
      if (
        event.organization_id !== organizationId ||
        event.account !== undefined
      ) {
        throw new BachsError(
          "WRONG_ACCOUNT",
          "Webhook does not belong to the configured owner.",
        );
      }
      const data = object(event.data, "INVALID_EVENT");
      try {
        freezeData(data);
      } catch {
        return fail("INVALID_EVENT");
      }
      return rememberAuthenticated(
        Object.freeze({
          id: identifier(event.id, "INVALID_EVENT"),
          type: text(event.type, 128, "INVALID_EVENT"),
          createdAt: timestamp(event.created_at, "INVALID_EVENT"),
          organizationId,
          environment,
          data,
        }),
      );
    },
  });
}
