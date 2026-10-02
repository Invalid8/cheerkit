import { SupportServiceError } from "./errors.js";
import type { SupportService } from "./index.js";

export interface PendingPassOptions {
  readonly pageSize: number;
  readonly maxPages: number;
}

export interface PendingPassResult {
  readonly processed: number;
  readonly applied: number;
  readonly review: number;
  readonly unsupported: number;
  readonly stillPending: number;
}

export interface WorkerPassResult extends PendingPassResult {
  readonly effects: {
    readonly succeeded: number;
    readonly retrying: number;
    readonly failed: number;
  };
  /** Contributions whose supporter data the retention period removed in this pass. */
  readonly retention: number;
}

export interface PendingWorkerOptions extends PendingPassOptions {
  readonly intervalMs: number;
  /** Receives counts only. */
  readonly onPass?: (result: WorkerPassResult) => void;
  /** Receives the error's name and code only. */
  readonly onError?: (report: {
    readonly name: string;
    readonly code: string | undefined;
  }) => void;
}

function checked(options: PendingPassOptions): PendingPassOptions {
  if (
    !Number.isSafeInteger(options.pageSize) ||
    options.pageSize < 1 ||
    options.pageSize > 100 ||
    !Number.isSafeInteger(options.maxPages) ||
    options.maxPages < 1
  ) {
    throw new SupportServiceError(
      "INVALID_CONFIGURATION",
      "Page size must be 1–100 and page count positive.",
    );
  }
  return options;
}

/** One bounded scan of pending events. Each pass starts over because event IDs sort lexically, not by arrival. */
export async function runPendingPass(
  service: SupportService,
  options: PendingPassOptions,
): Promise<PendingPassResult> {
  const { pageSize, maxPages } = checked(options);
  const totals = {
    processed: 0,
    applied: 0,
    review: 0,
    unsupported: 0,
    stillPending: 0,
  };
  let afterId: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const events = await service.processPending({
      limit: pageSize,
      ...(afterId === undefined ? {} : { afterId }),
    });
    for (const { state } of events) {
      totals.processed++;
      if (state === "applied") totals.applied++;
      else if (state === "review") totals.review++;
      else if (state === "unsupported") totals.unsupported++;
      else if (state === "pending") totals.stillPending++;
    }
    if (events.length < pageSize) break;
    afterId = events.at(-1)!.event.id;
  }
  return totals;
}

/**
 * Runs a pending-event pass, up to `pageSize` due post-payment effects, and the retention cleanup, on a timer in this process.
 * After a failed pass the delay doubles, up to 32 times the interval.
 */
export function startPendingWorker(
  service: SupportService,
  options: PendingWorkerOptions,
): { stop(): void } {
  checked(options);
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1000) {
    throw new SupportServiceError(
      "INVALID_CONFIGURATION",
      "Worker interval must be at least one second.",
    );
  }
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(
      () => void tick(),
      options.intervalMs * 2 ** Math.min(failures, 5),
    );
  };
  const tick = async () => {
    try {
      const pending = await runPendingPass(service, options);
      const effects = await service.runEffects({ limit: options.pageSize });
      options.onPass?.({
        ...pending,
        effects,
        retention: await service.applyRetention(),
      });
      failures = 0;
    } catch (error) {
      failures++;
      const report =
        error instanceof Error
          ? { name: error.name, code: (error as { code?: unknown }).code }
          : { name: "Error", code: undefined };
      options.onError?.({
        name: report.name,
        code: typeof report.code === "string" ? report.code : undefined,
      });
    }
    schedule();
  };
  schedule();
  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
