export type CheerkitErrorCode =
  | "INVALID_INPUT"
  | "INVALID_AMOUNT"
  | "INVALID_CONTEXT"
  | "CONTEXT_CLOSED"
  | "UNSUPPORTED_CURRENCY"
  | "AMOUNT_OUT_OF_RANGE"
  | "FIELD_DISABLED";

/** A machine-readable rejection; messages never echo submitted field values. */
export class CheerkitError extends Error {
  override readonly name = "CheerkitError";

  constructor(
    readonly code: CheerkitErrorCode,
    message: string,
  ) {
    super(message);
  }
}
