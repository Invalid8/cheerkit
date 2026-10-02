export class SupportServiceError extends Error {
  override readonly name = "SupportServiceError";
  constructor(
    readonly code: "UNAUTHORIZED" | "INVALID_CONFIGURATION" | "INVALID_REQUEST",
    message: string,
  ) {
    super(message);
  }
}
