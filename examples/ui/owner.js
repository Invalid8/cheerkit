import { formatAmount } from "./support.js";

const api = "/api/support/owner";
const pageSize = 50;
const statuses = {
  confirmed: "Confirmed",
  needs_review: "Needs review",
  awaiting_payment: "Waiting for payment",
  checkout_unresolved: "Checkout not confirmed",
  unsuccessful: "Not completed",
};
const errorMessages = {
  forbidden: "Sign in as the owner to see this page.",
  origin_not_allowed: "Open this page from the site's own address.",
  invalid_amount: "Enter an amount such as 5 or 5.50, without a currency sign.",
  invalid_input: "Fill in every field; notes can be up to 2,000 characters.",
  invalid_state: "That is not possible for this contribution now.",
  conflict: "This changed at the same time. Reload and try again.",
  recovery_failed: "Bachs has no matching checkout with that ID.",
  lookup_failed: "Bachs did not return this payment. Try again shortly.",
};

const status = document.querySelector("[data-status]");
const contextFilter = document.getElementById("filter-context");
const statusFilter = document.getElementById("filter-status");
const newer = document.querySelector("[data-newer]");
const older = document.querySelector("[data-older]");
let pages = [null];
let lastOnPage = null;
let selected = null;

const element = (tag, properties = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), properties);
  node.append(...children);
  return node;
};
const money = (amount, currency) => formatAmount(amount, currency);
const when = (iso) => new Date(iso).toLocaleString();
const words = (code) => code.replaceAll("_", " ");
const describe = (error) => {
  if (error.code === undefined) {
    console.error(error);
    return "Something went wrong on this page. Reload and try again.";
  }
  return errorMessages[error.code] ?? `That did not work (${error.code}).`;
};

async function call(path, init) {
  const response = await fetch(
    `${api}${path}`,
    init && {
      ...init,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(init.body ?? {}),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload.error ?? "server_error";
    throw Object.assign(new Error(code), { code });
  }
  return payload;
}

const post = (path, body) => call(path, { method: "POST", body });

function button(label, onClick, feedback = status) {
  const node = element("button", { type: "button", textContent: label });
  node.addEventListener("click", async () => {
    node.disabled = true;
    try {
      await onClick();
    } catch (error) {
      feedback.textContent = describe(error);
      node.disabled = false;
    }
  });
  return node;
}

function form(title, submitText, fields, onSubmit) {
  const node = element(
    "form",
    { className: "inline" },
    element("p", { className: "form-title", textContent: title }),
  );
  const feedback = element("p", { className: "status", role: "status" });
  const inputs = fields.map(([name, label, attributes = {}]) => {
    const id = `${name}-${crypto.randomUUID()}`;
    const input = element(name === "note" ? "textarea" : "input", {
      id,
      name,
      required: true,
      ...attributes,
    });
    node.append(element("label", { htmlFor: id, textContent: label }), input);
    return input;
  });
  node.append(
    element("button", { type: "submit", textContent: submitText }),
    feedback,
  );
  node.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "Saving…";
    try {
      await onSubmit(
        Object.fromEntries(inputs.map((input) => [input.name, input.value])),
      );
    } catch (error) {
      feedback.textContent = describe(error);
    }
  });
  return node;
}

function feeText(fee) {
  if (fee.state === "unreported") return "Not reported yet";
  if (fee.state === "none") return "None, according to Bachs";
  const payer = fee.bearer === "customer" ? ", paid by the supporter" : "";
  return `${money(fee.amount, fee.currency)}${payer}`;
}

function paymentFacts(payment) {
  const { settlement, statement } = payment;
  return [
    [
      "Paid",
      `${money(payment.amount, payment.currency)} (${payment.chargeId})`,
    ],
    ...(statement && statement.currency !== payment.currency
      ? [["Supporter was charged", money(statement.amount, statement.currency)]]
      : []),
    ["Bachs fee", feeText(payment.fee)],
    [
      "Reported settlement",
      settlement
        ? money(settlement.amount, settlement.currency)
        : "Not reported by Bachs",
    ],
    ...(statement
      ? [
          [
            "Checked with Bachs",
            `${when(statement.retrievedAt)}, ${words(statement.status)}`,
          ],
        ]
      : []),
    ...payment.refunds.map((refund) => [
      "Refund",
      `${money(refund.refundedAmount, payment.currency)}, ${refund.status}`,
    ]),
    ...payment.disputes.map((dispute) => ["Dispute", words(dispute.status)]),
  ];
}

function removedText({ at, by }) {
  const who = {
    retention: "after the retention period",
    owner: "by the owner",
    supporter: "at the supporter's request",
  }[by];
  return `Removed ${who}, ${when(at)}`;
}

async function showDetail(id, message = "") {
  selected = id;
  const path = `/contributions/${encodeURIComponent(id)}`;
  const [contribution, events] = await Promise.all([
    call(path),
    call(`/events?contributionId=${encodeURIComponent(id)}`),
  ]);
  const { intent } = contribution;
  const removed = contribution.personalDataRemoved;
  const facts = [
    ["Context", intent.contextId],
    ["Started", when(intent.createdAt)],
    ["Intended", money(intent.amount, intent.currency)],
    ["Status", statuses[contribution.status]],
    ["Name", intent.supporterName ?? (removed ? removedText(removed) : "—")],
    ["Message", intent.message ?? (removed ? removedText(removed) : "—")],
    ...Object.entries(contribution.metadata).map(([key, value]) => [
      key,
      String(value),
    ]),
    ...contribution.payments.flatMap(paymentFacts),
    ...contribution.attempts.map((attempt, index) => [
      `Attempt ${index + 1}`,
      attempt.checkout
        ? `${attempt.state}, checkout ${attempt.checkout.id} (${attempt.checkout.status})`
        : attempt.state,
    ]),
    ...contribution.ownerRecords.map((record) => [
      record.kind === "external_return" ? "Returned outside Bachs" : "Accepted",
      `${record.amount ? `${money(record.amount, record.currency)}: ` : ""}${record.note}`,
    ]),
    ...events.map((stored) => [
      "Bachs event",
      `${stored.event.type}, ${stored.state}${stored.reason ? ` (${words(stored.reason)})` : ""}`,
    ]),
  ];

  const section = document.querySelector("[data-detail]");
  const feedback = section.querySelector("[data-detail-status]");
  feedback.textContent = message;
  section
    .querySelector("[data-facts]")
    .replaceChildren(
      ...facts.flatMap(([term, value]) => [
        element("dt", { textContent: term }),
        element("dd", { textContent: value }),
      ]),
    );

  const after = (text) => refresh(text);
  const actions = [];
  for (const stored of events) {
    if (stored.state === "review" || stored.state === "dismissed") {
      actions.push(
        button(
          `Check ${stored.event.type} again`,
          async () => {
            const result = await post(
              `/events/${encodeURIComponent(stored.event.id)}/recheck`,
            );
            await after(`Checked again: ${result.state}.`);
          },
          feedback,
        ),
      );
    }
  }
  if (contribution.status === "needs_review" && contribution.payments.length) {
    actions.push(
      form(
        "Accept after checking in Bachs",
        "Accept",
        [["note", "Note"]],
        async ({ note }) => {
          await post(`${path}/accept-review`, { note });
          await after("Accepted.");
        },
      ),
    );
  }
  if (contribution.status === "checkout_unresolved") {
    actions.push(
      button(
        "Retry the checkout request",
        async () => {
          await post(`${path}/retry`);
          await after("Checkout request sent again.");
        },
        feedback,
      ),
      form(
        "Recover by checkout ID from Bachs",
        "Recover",
        [["checkoutId", "Checkout ID"]],
        async ({ checkoutId }) => {
          await post(`${path}/recover`, { checkoutId: checkoutId.trim() });
          await after(
            "Checkout attached. It confirms once Bachs reports the payment.",
          );
        },
      ),
    );
  }
  if (contribution.payments.length) {
    actions.push(
      button(
        "Refresh payment details",
        async () => {
          await post(`${path}/payment-details`);
          await after("Payment details updated from Bachs.");
        },
        feedback,
      ),
      form(
        "Record money you returned outside Bachs",
        "Record",
        [
          ["amount", "Amount", { inputMode: "decimal" }],
          ["note", "Note"],
        ],
        async (input) => {
          await post(`${path}/external-returns`, input);
          await after("Return recorded.");
        },
      ),
    );
  }
  if (intent.supporterName || intent.message) {
    actions.push(
      button(
        "Remove name and message",
        async () => {
          await post(`${path}/remove-personal-data`);
          await after("Removed. Payment facts stay.");
        },
        feedback,
      ),
    );
  }
  section.querySelector("[data-actions]").replaceChildren(...actions);
  section.hidden = false;
  section.querySelector("#detail-title").focus();
}

function contributionsQuery() {
  const cursor = pages.at(-1);
  return new URLSearchParams({
    limit: String(pageSize),
    ...(contextFilter.value ? { contextId: contextFilter.value } : {}),
    ...(statusFilter.value ? { status: statusFilter.value } : {}),
    ...(cursor
      ? { beforeCreatedAt: cursor.createdAt, beforeId: cursor.id }
      : {}),
  });
}

function renderSummary(summary) {
  const counts = summary.contributions;
  const lines = [
    [counts.needs_review, "contributions need review"],
    [counts.checkout_unresolved, "checkout requests to retry or recover"],
    [summary.openDisputes, "open disputes: respond in Bachs"],
    [summary.effects.failed, "follow-up actions failed"],
    [
      summary.events.review + summary.events.pending,
      "unresolved provider events",
    ],
  ].filter(([count]) => count > 0);
  document
    .querySelector("[data-summary]")
    .replaceChildren(
      ...(lines.length
        ? lines.map(([count, text]) =>
            element("li", { textContent: `${count} ${text}` }),
          )
        : [element("li", { textContent: "Nothing needs attention." })]),
    );
}

function renderContexts(contexts) {
  const chosen = contextFilter.value;
  contextFilter.replaceChildren(
    new Option("All", ""),
    ...contexts.map(({ context }) => new Option(context.name, context.id)),
  );
  contextFilter.value = chosen;
  document.querySelector("[data-contexts]").replaceChildren(
    ...contexts.map(({ context, revision }) =>
      element(
        "li",
        {},
        `${context.name}: ${context.acceptingContributions ? "accepting support" : "paused"} `,
        button(
          context.acceptingContributions ? "Pause" : "Resume",
          async () => {
            await call(`/contexts/${encodeURIComponent(context.id)}`, {
              method: "PUT",
              body: {
                context: {
                  ...context,
                  acceptingContributions: !context.acceptingContributions,
                },
                expectedRevision: revision,
              },
            });
            await refresh();
          },
        ),
      ),
    ),
  );
}

function renderContributions(page) {
  lastOnPage = page.at(-1)?.intent ?? null;
  newer.disabled = pages.length === 1;
  older.disabled = page.length < pageSize;
  document.querySelector("[data-rows]").replaceChildren(
    ...page.map((entry) => {
      const { intent } = entry;
      const open = element("button", {
        type: "button",
        textContent: "Details",
      });
      open.setAttribute(
        "aria-label",
        `Details for ${money(intent.amount, intent.currency)} on ${when(intent.createdAt)}`,
      );
      open.addEventListener("click", () =>
        showDetail(intent.id).catch(
          (error) => (status.textContent = describe(error)),
        ),
      );
      return element(
        "tr",
        {},
        element("td", { textContent: when(intent.createdAt) }),
        element("td", { textContent: intent.contextId }),
        element("td", { textContent: money(intent.amount, intent.currency) }),
        element("td", { textContent: statuses[entry.status] }),
        element("td", {}, open),
      );
    }),
  );
}

function renderEvents(events) {
  document.querySelector("[data-events]").replaceChildren(
    ...events.map((stored) =>
      element(
        "li",
        {},
        `${stored.event.type}, ${when(stored.event.createdAt)}: ${words(stored.reason ?? stored.state)} `,
        form("Dismiss", "Dismiss", [["note", "Why"]], async ({ note }) => {
          await post(`/events/${encodeURIComponent(stored.event.id)}/dismiss`, {
            note,
          });
          await refresh();
        }),
      ),
    ),
  );
}

async function refresh(message = "") {
  status.textContent = "";
  try {
    const [summary, contexts, page, review, pending] = await Promise.all([
      call("/summary"),
      call("/contexts"),
      call(`/contributions?${contributionsQuery()}`),
      call("/events?state=review"),
      call("/events?state=pending"),
    ]);
    renderSummary(summary);
    renderContexts(contexts);
    renderContributions(page);
    renderEvents([...review, ...pending]);
    if (selected) await showDetail(selected, message);
  } catch (error) {
    status.textContent = describe(error);
  }
}

for (const filter of [contextFilter, statusFilter]) {
  filter.addEventListener("change", () => {
    pages = [null];
    refresh();
  });
}
newer.addEventListener("click", () => {
  pages.pop();
  refresh();
});
older.addEventListener("click", () => {
  if (!lastOnPage) return;
  pages.push({ createdAt: lastOnPage.createdAt, id: lastOnPage.id });
  refresh();
});
refresh();
