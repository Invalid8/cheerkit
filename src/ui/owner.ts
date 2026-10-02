import type {
  StoreSummary,
  StoredContext,
  StoredContribution,
  StoredEffect,
  StoredEvent,
  ContributionStatus,
} from "../server/store.js";
import type { SupportContextInput } from "../core/context.js";

export type {
  StoreSummary,
  StoredContext,
  StoredContribution,
  StoredEffect,
  StoredEvent,
  ContributionStatus,
};

export class OwnerRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "OwnerRequestError";
  }
}

export interface OwnerClientOptions {
  /** Base path of the Cheerkit routes on this site, such as `/api/support`. */
  readonly api: string;
  readonly fetch?: typeof fetch;
}

export interface ContributionQuery {
  readonly status?: ContributionStatus;
  readonly contextId?: string;
  readonly before?: { readonly createdAt: string; readonly id: string };
  readonly limit?: number;
}

export type OwnerClient = ReturnType<typeof createOwnerClient>;

/** Typed calls for every owner route. Authorization stays with the host: requests carry the browser's own cookies. */
export function createOwnerClient(options: OwnerClientOptions) {
  const base = `${options.api.replace(/\/+$/, "")}/owner`;
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await request(`${base}${path}`, {
        method,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
      });
    } catch {
      throw new OwnerRequestError("network", 0);
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
      };
      throw new OwnerRequestError(
        typeof payload.error === "string" ? payload.error : "server_error",
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  const query = (values: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined && value !== "") params.set(key, String(value));
    const text = params.toString();
    return text ? `?${text}` : "";
  };
  const id = encodeURIComponent;

  return {
    summary: () => call<StoreSummary>("/summary"),
    listContributions: (input: ContributionQuery = {}) =>
      call<StoredContribution[]>(
        `/contributions${query({
          status: input.status,
          contextId: input.contextId,
          limit: input.limit,
          beforeCreatedAt: input.before?.createdAt,
          beforeId: input.before?.id,
        })}`,
      ),
    getContribution: (contributionId: string) =>
      call<StoredContribution>(`/contributions/${id(contributionId)}`),
    acceptReview: (contributionId: string, note: string) =>
      call(`/contributions/${id(contributionId)}/accept-review`, "POST", {
        note,
      }),
    recordExternalReturn: (
      contributionId: string,
      amount: string,
      note: string,
    ) =>
      call(`/contributions/${id(contributionId)}/external-returns`, "POST", {
        amount,
        note,
      }),
    retryCheckout: (contributionId: string) =>
      call(`/contributions/${id(contributionId)}/retry`, "POST"),
    recoverCheckout: (contributionId: string, checkoutId: string) =>
      call(`/contributions/${id(contributionId)}/recover`, "POST", {
        checkoutId,
      }),
    refreshPaymentDetails: (contributionId: string) =>
      call(`/contributions/${id(contributionId)}/payment-details`, "POST"),
    resendNotices: (contributionId: string) =>
      call(`/contributions/${id(contributionId)}/resend-notices`, "POST"),
    removePersonalData: (contributionId: string) =>
      call(`/contributions/${id(contributionId)}/remove-personal-data`, "POST"),
    listEvents: (
      input: {
        state?: StoredEvent["state"];
        contributionId?: string;
        limit?: number;
      } = {},
    ) => call<StoredEvent[]>(`/events${query(input)}`),
    dismissEvent: (eventId: string, note: string) =>
      call(`/events/${id(eventId)}/dismiss`, "POST", { note }),
    reopenEvent: (eventId: string) =>
      call(`/events/${id(eventId)}/reopen`, "POST"),
    recheckEvent: (eventId: string) =>
      call<StoredEvent>(`/events/${id(eventId)}/recheck`, "POST"),
    listContexts: () => call<StoredContext[]>("/contexts"),
    putContext: (context: SupportContextInput, expectedRevision: number) =>
      call<StoredContext>(`/contexts/${id(context.id)}`, "PUT", {
        context,
        expectedRevision,
      }),
    listEffects: (
      input: {
        state?: StoredEffect["state"];
        contributionId?: string;
        limit?: number;
      } = {},
    ) => call<StoredEffect[]>(`/effects${query(input)}`),
    retryEffect: (contributionId: string, name: string) =>
      call(`/effects/${id(contributionId)}/${id(name)}/retry`, "POST"),
    exportData: () => call<unknown>("/export"),
  };
}
