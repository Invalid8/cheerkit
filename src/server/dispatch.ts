import type { BachsClient } from "../bachs/client.js";
import { BachsError } from "../bachs/errors.js";
import type { CheerkitStore } from "./store.js";

/** False when the store does not allow the request to be sent now. */
export async function sendCheckout(
  store: CheerkitStore,
  bachs: BachsClient,
  contributionId: string,
  at: number,
): Promise<boolean> {
  const credential = await bachs.credentialFingerprint();
  const claim = await store.claimCheckout(contributionId, {
    credential,
    at,
    retryUntil: at + bachs.retryWindowMs,
    leaseUntil: at + bachs.timeoutMs,
  });
  if (!claim) return false;
  let result;
  try {
    result = await bachs.createCheckout(claim.request);
  } catch (error) {
    if (
      !(error instanceof BachsError) ||
      (error.code !== "CHECKOUT_REJECTED" &&
        error.code !== "CHECKOUT_UNCERTAIN")
    )
      throw error;
    // A retry cannot prove an earlier dispatch of the same key was never accepted.
    await store.recordCheckoutFailure(
      contributionId,
      error.code === "CHECKOUT_REJECTED" && !claim.retry
        ? "rejected"
        : "uncertain",
    );
  }
  if (result) await store.recordCheckout(contributionId, result);
  return true;
}
