const submissionKey = "cheerkit:submission";
const resultKey = "cheerkit:result";

function read(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private browsing); a retry then starts a new submission.
  }
}

export async function request(api, path, body) {
  let response;
  try {
    response = await fetch(
      `${api}${path}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw Object.assign(new Error("network"), { code: "network" });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(payload.error ?? "server_error"), {
      code: payload.error ?? "server_error",
    });
  return payload;
}

export const loadContext = (api, contextId) =>
  request(api, `/contexts/${encodeURIComponent(contextId)}`);

const remember = (access) => {
  write(resultKey, {
    contributionId: access.contribution.contributionId,
    resultToken: access.resultToken,
  });
  return access;
};

/**
 * Starts a contribution. Only the submission key is kept in the tab (never the name or message), so a lost response
 * or a later "Try again" continues the same contribution through `resumeContribution`.
 */
export async function startContribution(api, contextId, submission, metadata) {
  const key = crypto.randomUUID();
  write(submissionKey, key);
  return remember(
    await request(api, "/contributions", {
      contextId,
      submission,
      submissionKey: key,
      ...(metadata ? { metadata } : {}),
    }),
  );
}

export async function resumeContribution(api) {
  const key = read(submissionKey);
  if (typeof key !== "string")
    throw Object.assign(new Error("not_found"), { code: "not_found" });
  return remember(
    await request(api, "/contributions/resume", { submissionKey: key }),
  );
}

export const hasSubmission = () => typeof read(submissionKey) === "string";
export const savedAccess = () => read(resultKey);

export function getStatus(api, access) {
  return request(api, "/contributions/status", {
    contributionId: access.contributionId,
    resultToken: access.resultToken,
  });
}

export function forgetSubmission() {
  write(submissionKey, null);
}

export function removeOwnData(api, access) {
  return request(api, "/contributions/remove-data", {
    contributionId: access.contributionId,
    resultToken: access.resultToken,
  });
}

export function formatAmount(amount, currency, locale) {
  const digits = amount.split(".")[1]?.length ?? 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

export const errorMessages = {
  network:
    "We could not reach the server. Check your connection and try again; you will not be charged twice.",
  rate_limited:
    "Too many attempts in a short time. Please wait a minute and try again.",
  context_closed: "This is not accepting new support right now.",
  amount_out_of_range: "Choose an amount within the range shown.",
  invalid_amount: "Enter the amount as a number, for example 2500 or 25.50.",
  unsupported_currency: "Choose one of the currencies listed.",
  field_disabled: "Remove the name or message; this page does not collect it.",
  invalid_input: "Check the name and message lengths and try again.",
  conflict:
    "This submission changed while it was being processed. Please submit again.",
  retry_later: "The server is busy. Please try again shortly.",
};

export const describeError = (error) =>
  errorMessages[error?.code] ??
  "Something went wrong on our side. Please try again.";
