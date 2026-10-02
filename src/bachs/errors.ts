export type BachsErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_CHECKOUT"
  | "CHECKOUT_REJECTED"
  | "CHECKOUT_UNCERTAIN"
  | "RECOVERY_FAILED"
  | "RESEND_FAILED"
  | "LOOKUP_FAILED"
  | "INVALID_SIGNATURE"
  | "INVALID_EVENT"
  | "WRONG_ACCOUNT";

export class BachsError extends Error {
  override readonly name = "BachsError";

  constructor(
    readonly code: BachsErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}
