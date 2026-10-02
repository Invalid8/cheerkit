export interface CurrencyRules {
  readonly currency: string;
  readonly fractionDigits: number;
  readonly minimum: string;
  readonly maximum?: string;
  readonly suggestedAmounts: readonly string[];
}

export interface PublicContext {
  readonly contextId: string;
  readonly acceptingContributions: boolean;
  readonly currencies: readonly CurrencyRules[];
  readonly collectName: boolean;
  readonly collectMessage: boolean;
  readonly fees: "owner" | "supporter" | "account_default";
}

export type Outcome =
  "pending" | "confirmed" | "refunded" | "needs_review" | "unsuccessful";

export interface PublicContribution {
  readonly contributionId: string;
  readonly contextId: string;
  readonly outcome: Outcome;
  readonly amount: string;
  readonly currency: string;
  readonly checkoutUrl?: string;
}

export interface OwnData {
  readonly contribution: PublicContribution;
  readonly supporterName?: string;
  readonly message?: string;
  readonly personalDataRemoved?: unknown;
}

export interface Submission {
  readonly amount: string;
  readonly currency: string;
  readonly supporterName?: string;
  readonly message?: string;
}

export type SupportState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable"; readonly error: string }
  | { readonly status: "closed"; readonly context: PublicContext }
  | {
      readonly status: "ready";
      readonly context: PublicContext;
      readonly error?: string;
    }
  | { readonly status: "submitting"; readonly context: PublicContext }
  | { readonly status: "redirecting"; readonly checkoutUrl: string }
  | { readonly status: "no-result" }
  | {
      readonly status: "result";
      readonly contribution: PublicContribution;
      readonly checking: boolean;
      readonly error?: string;
    };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SupportOptions {
  /** Base path of the Cheerkit routes on this site, such as `/api/support`. */
  readonly api: string;
  readonly contextId: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  /** Defaults to `sessionStorage`; `null` keeps nothing between page loads. */
  readonly storage?: StorageLike | null;
  readonly fetch?: typeof fetch;
  /** How long `watchResult` keeps checking a pending payment. Default 10 minutes. */
  readonly maxWaitMs?: number;
  readonly delays?: readonly number[];
}

export interface Support {
  readonly state: SupportState;
  subscribe(listener: (state: SupportState) => void): () => void;
  load(): Promise<void>;
  submit(submission: Submission): Promise<void>;
  /** Loads the result saved in this tab, if any. */
  checkResult(): Promise<void>;
  /** Checks a pending result with growing gaps until it settles, the wait runs out, or `signal` aborts. */
  watchResult(signal?: AbortSignal): Promise<void>;
  /** After an unsuccessful payment: a new attempt for the same contribution, reported as `redirecting`. */
  tryAgain(): Promise<void>;
  readOwnData(): Promise<OwnData>;
  removeOwnData(): Promise<OwnData>;
}

export class SupportRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SupportRequestError";
  }
}

interface SavedSubmission {
  readonly key: string;
}

interface SavedAccess {
  readonly contributionId: string;
  readonly resultToken: string;
}

const settled: ReadonlySet<Outcome> = new Set([
  "confirmed",
  "refunded",
  "unsuccessful",
]);

/**
 * The checkout link is navigated to only over HTTPS, or plain HTTP on the local machine for development.
 */
export function safeCheckoutUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return url.protocol === "https:" || (url.protocol === "http:" && local)
    ? url.href
    : null;
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

async function fingerprintOf(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createSupport(options: SupportOptions): Support {
  const api = options.api.replace(/\/+$/, "");
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const delays = options.delays ?? [1000, 2000, 3000, 5000, 8000, 10000];
  const maxWaitMs = options.maxWaitMs ?? 600_000;
  const submissionKey = `cheerkit:${options.contextId}:submission`;
  const accessKey = `cheerkit:${options.contextId}:result`;
  const listeners = new Set<(state: SupportState) => void>();
  let state: SupportState = { status: "loading" };
  let lastFingerprint: string | null = null;

  const set = (next: SupportState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  const read = <T>(key: string): T | null => {
    try {
      const raw = storage?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: unknown) => {
    try {
      if (value === null) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable (private browsing): retries then start a new submission.
    }
  };

  async function call<T>(path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await request(
        `${api}${path}`,
        body === undefined
          ? { headers: { Accept: "application/json" } }
          : {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            },
      );
    } catch {
      throw new SupportRequestError("network");
    }
    const payload = (await response.json().catch(() => ({}))) as {
      error?: unknown;
    };
    if (!response.ok)
      throw new SupportRequestError(
        typeof payload.error === "string" ? payload.error : "server_error",
      );
    return payload as T;
  }

  const codeOf = (error: unknown) =>
    error instanceof SupportRequestError ? error.code : "server_error";

  const access = (): SavedAccess => {
    const saved = read<SavedAccess>(accessKey);
    if (!saved) throw new SupportRequestError("not_found");
    return saved;
  };

  function afterStart(result: {
    contribution: PublicContribution;
    resultToken: string;
  }) {
    write(accessKey, {
      contributionId: result.contribution.contributionId,
      resultToken: result.resultToken,
    });
    const checkoutUrl = result.contribution.checkoutUrl
      ? safeCheckoutUrl(result.contribution.checkoutUrl)
      : null;
    set(
      checkoutUrl
        ? { status: "redirecting", checkoutUrl }
        : {
            status: "result",
            contribution: result.contribution,
            checking: true,
          },
    );
  }

  function showResult(contribution: PublicContribution, checking: boolean) {
    if (settled.has(contribution.outcome)) write(submissionKey, null);
    set({ status: "result", contribution, checking });
  }

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      set({ status: "loading" });
      try {
        const context = await call<PublicContext>(
          `/contexts/${encodeURIComponent(options.contextId)}`,
        );
        set(
          context.acceptingContributions
            ? { status: "ready", context }
            : { status: "closed", context },
        );
      } catch (error) {
        set({ status: "unavailable", error: codeOf(error) });
      }
    },
    async submit(submission) {
      if (state.status !== "ready") return;
      const context = state.context;
      set({ status: "submitting", context });
      const fingerprint = await fingerprintOf({
        contextId: options.contextId,
        submission,
        metadata: options.metadata ?? null,
      });
      const saved = read<SavedSubmission>(submissionKey);
      const key =
        saved && lastFingerprint === fingerprint
          ? saved.key
          : crypto.randomUUID();
      lastFingerprint = fingerprint;
      write(submissionKey, { key });
      try {
        afterStart(
          await call("/contributions", {
            contextId: options.contextId,
            submission,
            submissionKey: key,
            ...(options.metadata ? { metadata: options.metadata } : {}),
          }),
        );
      } catch (error) {
        const code = codeOf(error);
        if (code !== "network" && code !== "retry_later")
          write(submissionKey, null);
        set({ status: "ready", context, error: code });
      }
    },
    async checkResult() {
      const saved = read<SavedAccess>(accessKey);
      if (!saved) {
        set({ status: "no-result" });
        return;
      }
      try {
        const contribution = await call<PublicContribution>(
          "/contributions/status",
          saved,
        );
        showResult(contribution, !settled.has(contribution.outcome));
      } catch (error) {
        const code = codeOf(error);
        if (code === "not_found") {
          write(accessKey, null);
          set({ status: "no-result" });
        } else if (state.status === "result")
          set({ ...state, checking: false, error: code });
        else set({ status: "unavailable", error: code });
      }
    },
    async watchResult(signal) {
      const started = Date.now();
      let attempt = 0;
      while (state.status === "result" && state.checking && !signal?.aborted) {
        if (Date.now() - started >= maxWaitMs) {
          set({ ...state, checking: false });
          return;
        }
        const delay = delays[Math.min(attempt, delays.length - 1)] ?? 10000;
        attempt += 1;
        const aborted = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), delay);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve(true);
            },
            { once: true },
          );
        });
        if (aborted) return;
        await this.checkResult();
      }
    },
    async tryAgain() {
      const saved = read<SavedSubmission>(submissionKey);
      if (!saved) {
        set({ status: "no-result" });
        return;
      }
      try {
        afterStart(
          await call("/contributions/resume", { submissionKey: saved.key }),
        );
      } catch (error) {
        if (state.status === "result")
          set({ ...state, checking: false, error: codeOf(error) });
      }
    },
    readOwnData() {
      return call<OwnData>("/contributions/data", access());
    },
    removeOwnData() {
      return call<OwnData>("/contributions/remove-data", access());
    },
  };
}
