import { adminStyles } from "./admin-styles.js";
import { readableOn, warnIfLowContrast } from "./color.js";
import { fill, formatMoney, h, icon, safeImage, type Child } from "./dom.js";
import {
  createOwnerClient,
  OwnerRequestError,
  type ContributionStatus,
  type OwnerClient,
  type StoreSummary,
  type StoredContext,
  type StoredContribution,
  type StoredEffect,
  type StoredEvent,
} from "./owner.js";
import { themeVariables, type ThemeVariable } from "./styles.js";

export const defaultAdminText = {
  adminLabel: "Support admin",
  navContributions: "Contributions",
  navNotices: "Unmatched notices",
  navContexts: "Contexts",
  navEffects: "Follow-up actions",
  navExport: "Export",
  show: "Show",
  contributionsSub:
    "Every contribution, newest first. Amounts stay in the currency they were paid in.",
  confirmedSupport: "Confirmed support",
  confirmedSupportNote: "After refunds and returns",
  confirmedCount: "Confirmed",
  confirmedCountNote: "of {total} started",
  reviewCount: "Need your review",
  reviewCountNote: "Open one to accept it or record a return",
  disputes: "Open disputes",
  disputesNote: "Respond to them in Bachs",
  all: "All",
  statusConfirmed: "Confirmed",
  statusNeedsReview: "Needs review",
  statusAwaiting: "Awaiting payment",
  statusUnresolved: "Checkout unresolved",
  statusUnsuccessful: "Unsuccessful",
  when: "When",
  amount: "Amount",
  from: "From",
  context: "Context",
  status: "Status",
  open: "Open",
  openLabel: "Open {amount} from {when}",
  anonymous: "Anonymous",
  removed: "Removed",
  newer: "Newer",
  older: "Older",
  showing: "Showing {count}",
  emptyAll: "No contributions yet",
  emptyAllBody: "When someone supports you, it shows up here.",
  emptyFiltered: "Nothing here",
  emptyFilteredBody: "No contributions have this status right now.",
  showAll: "Show all contributions",
  close: "Close",
  started: "Started {when}",
  reviewTitle: "This payment needs your decision",
  reviewBody:
    "Bachs reported something Cheerkit couldn't match on its own ({reason}). Accept to confirm it, or record a return after you refund it.",
  payments: "Payments",
  charge: "Charge {id}",
  fee: "fee {amount}",
  feeNone: "no fee",
  feeUnreported: "fee not reported",
  settlement: "Settlement",
  settlementMissing: "Not reported by Bachs",
  supporterCharged: "Supporter was charged",
  refund: "Refund",
  dispute: "Dispute",
  attempts: "Checkout attempts",
  attempt: "Attempt {number}",
  message: "Message",
  records: "Your records",
  accepted: "Accepted",
  returned: "Returned outside Bachs",
  decision: "Your decision",
  note: "Note",
  notePlaceholder: "Why you decided this, for your records",
  required: "Required",
  acceptConfirm: "Accept and confirm",
  recordReturn: "Record a return",
  returnAmount: "Amount returned",
  checkout: "Checkout",
  retryCheckout: "Send the checkout request again",
  recoverTitle: "Recover by checkout ID",
  recoverHint: "Paste the checkout ID from Bachs for this payment.",
  recover: "Recover",
  more: "More",
  refreshDetails: "Refresh payment details",
  resendNotices: "Resend notices",
  removeData: "Remove personal data",
  removeTitle: "Remove {name}'s personal data?",
  removeBody:
    "Their name, message and any extra details are deleted now and can't be brought back. Payment records stay, so your totals don't change.",
  removeKeep: "Keep it",
  nothingToDo: "Nothing needs doing here.",
  done: "Done.",
  saved: "Saved.",
  noticesSub:
    "Payment notices from Bachs that Cheerkit couldn't apply on its own. Nothing is lost: recheck one after a fix, or dismiss it with a note.",
  stateReview: "Needs review",
  statePending: "Waiting",
  stateUnsupported: "Unsupported",
  stateDismissed: "Dismissed",
  stateApplied: "Applied",
  received: "Received",
  notice: "Notice",
  why: "Why it stopped",
  none: "None",
  recheck: "Recheck",
  dismiss: "Dismiss",
  reopen: "Reopen",
  dismissTitle: "Dismiss this notice?",
  dismissBody:
    "It stays in the record with your note, and stops being processed. You can reopen it later.",
  emptyNotices: "Nothing here",
  emptyNoticesBody: "No payment notices are in this state.",
  contextsSub:
    "Each context is one thing people can support, with its own currencies and amounts. Changes apply to new contributions only.",
  taking: "Taking support",
  paused: "Paused",
  name: "Name",
  currency: "Currency",
  suggested: "Suggested amounts",
  suggestedHint: "Separate with commas",
  minimum: "Minimum",
  maximum: "Maximum",
  supporterFields: "What supporters can add",
  collectName: "Name",
  collectNameHint: "Shown to you and in thank-you messages",
  collectMessage: "Message",
  collectMessageHint: "Up to 280 characters",
  saveChanges: "Save changes",
  editorFoot: "Saved settings apply to new contributions only.",
  conflictTitle: "These settings changed while you were editing",
  conflictBody:
    "Nothing you typed was saved, and nothing was overwritten. Load the latest settings, then make your change again.",
  loadLatest: "Load latest",
  effectsSub:
    "What your site does after a payment is confirmed, such as sending a thank-you. Failed ones retry on their own a few times; you can retry them here.",
  effectFailed: "Failed",
  effectPending: "Waiting",
  effectRunning: "Running",
  effectSucceeded: "Done",
  contribution: "Contribution",
  action: "Action",
  attemptsCount: "Attempts",
  lastProblem: "Last problem",
  retry: "Retry",
  emptyEffects: "Nothing here",
  emptyEffectsBody: "No follow-up actions are in this state.",
  exportSub:
    "Everything Cheerkit holds for this site in one JSON file, for your records or a move to another host.",
  exportIncludes: "What's in the file",
  exportContributions: "Contributions, payments, refunds, returns and disputes",
  exportContexts: "Contexts and their settings",
  exportNotices: "Payment notices and your decisions, with notes",
  exportPeople: "Supporter names and messages that haven't been removed yet",
  exportPrivacy:
    "The file contains personal data. Store it somewhere only you can open, and delete copies you no longer need. It never includes payers' card or bank details: Cheerkit doesn't keep them.",
  download: "Download export",
  signedOutTitle: "Sign in to see your support",
  signedOutBody: "This page is for the site owner. Use your site's sign-in.",
  errorTitle: "Couldn't load this",
  tryAgain: "Try again",
  error_network: "Check your connection. Nothing was changed.",
  error_forbidden: "You're not signed in as the owner.",
  error_origin_not_allowed: "Open this page from the site's own address.",
  error_invalid_amount:
    "Enter an amount such as 5 or 5.50, without a currency sign.",
  error_invalid_input:
    "Fill in every field; notes can be up to 2,000 characters.",
  error_invalid_state: "That isn't possible for this contribution now.",
  error_conflict: "This changed at the same time. Reload and try again.",
  error_recovery_failed: "Bachs has no matching checkout with that ID.",
  error_lookup_failed: "Bachs didn't return this payment. Try again shortly.",
  error_default: "That didn't work. Try again.",
};

export type AdminText = typeof defaultAdminText;
type Screen = "contributions" | "notices" | "contexts" | "effects" | "export";

export interface AdminConfig {
  readonly siteName?: string;
  /** HTTPS or same-site image URL. */
  readonly logo?: string;
  readonly locale?: string;
  readonly pageSize?: number;
  /** Screens to show, in this order. Default: all. */
  readonly screens?: readonly Screen[];
  readonly text?: Partial<AdminText>;
  readonly appearance?: {
    readonly variables?: Partial<Record<ThemeVariable, string>>;
  };
}

const allScreens: readonly Screen[] = [
  "contributions",
  "notices",
  "contexts",
  "effects",
  "export",
];
const screenIcons: Record<Screen, string> = {
  contributions: "receipt",
  notices: "inbox",
  contexts: "sliders",
  effects: "zap",
  export: "download",
};
const statusOrder: readonly ContributionStatus[] = [
  "confirmed",
  "needs_review",
  "awaiting_payment",
  "checkout_unresolved",
  "unsuccessful",
];
const statusTone: Record<ContributionStatus, string> = {
  confirmed: "success",
  needs_review: "warning",
  awaiting_payment: "",
  checkout_unresolved: "warning",
  unsuccessful: "danger",
};
const eventStates: readonly StoredEvent["state"][] = [
  "review",
  "pending",
  "unsupported",
  "dismissed",
  "applied",
];
const effectStates: readonly StoredEffect["state"][] = [
  "failed",
  "pending",
  "running",
  "succeeded",
];

const words = (code: string) => {
  const text = code.replace(/[._]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

let sheet: CSSStyleSheet | null = null;

export class CheerkitAdminElement extends HTMLElement {
  static readonly observedAttributes = ["theme", "color"];

  #config: AdminConfig = {};
  #client: OwnerClient | null = null;
  #screen: Screen = "contributions";
  #summary: StoreSummary | null = null;
  #contexts: StoredContext[] = [];
  #status: ContributionStatus | "" = "";
  #cursors: ({ createdAt: string; id: string } | null)[] = [null];
  #eventState: StoredEvent["state"] = "review";
  #effectState: StoredEffect["state"] = "failed";
  #contextId: string | null = null;
  #main: HTMLElement;
  #nav: HTMLElement;
  #navSelect: HTMLSelectElement;
  #site: HTMLElement;
  #drawer: HTMLDialogElement;
  #modal: HTMLDialogElement;
  #onVisible = () => {
    if (
      document.visibilityState === "visible" &&
      !this.#drawer.open &&
      !this.#modal.open &&
      this.#screen !== "contexts" &&
      !this.#hasFocusedControl()
    )
      void this.#render(false);
  };

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    sheet ??= (() => {
      const created = new CSSStyleSheet();
      created.replaceSync(adminStyles);
      return created;
    })();
    root.adoptedStyleSheets = [sheet];
    this.#site = h("div", { class: "site" });
    this.#nav = h("nav", { class: "nav" });
    this.#navSelect = h("select", {
      class: "input nav-select",
    }) as HTMLSelectElement;
    this.#navSelect.addEventListener("change", () =>
      this.#go(this.#navSelect.value as Screen),
    );
    this.#main = h("main", { class: "main" });
    this.#drawer = h("dialog", {
      class: "drawer",
      part: "drawer",
      "aria-labelledby": "ck-drawer-title",
    }) as HTMLDialogElement;
    this.#modal = h("dialog", {
      class: "modal",
      part: "modal",
      "aria-labelledby": "ck-modal-title",
    }) as HTMLDialogElement;
    root.append(
      h(
        "div",
        { class: "admin", part: "admin" },
        h(
          "aside",
          { class: "sidebar", part: "sidebar" },
          this.#site,
          this.#nav,
          this.#navSelect,
        ),
        this.#main,
      ),
      this.#drawer,
      this.#modal,
    );
  }

  get config(): AdminConfig {
    return this.#config;
  }

  set config(value: AdminConfig) {
    this.#config = value ?? {};
    this.#applyAppearance();
    if (this.isConnected) this.#start();
  }

  connectedCallback() {
    this.#start();
    document.addEventListener("visibilitychange", this.#onVisible);
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this.#onVisible);
  }

  attributeChangedCallback() {
    this.#applyAppearance();
  }

  #hasFocusedControl() {
    const active = this.shadowRoot?.activeElement;
    return Boolean(
      active?.matches(
        "button, input, textarea, select, a, [contenteditable='true']",
      ) ||
      (document.activeElement instanceof HTMLElement &&
        this.contains(document.activeElement)),
    );
  }

  get #text(): AdminText {
    return { ...defaultAdminText, ...this.#config.text };
  }

  get #screens(): readonly Screen[] {
    const chosen = this.#config.screens?.filter((screen) =>
      allScreens.includes(screen),
    );
    return chosen?.length ? chosen : allScreens;
  }

  #applyAppearance() {
    const variables: Partial<Record<ThemeVariable, string>> = {
      ...this.#config.appearance?.variables,
    };
    const color = this.getAttribute("color");
    if (color) variables["color-primary"] = color;
    if (variables["color-primary"] && !variables["color-on-primary"]) {
      const readable = readableOn(variables["color-primary"]);
      if (readable) variables["color-on-primary"] = readable;
    }
    for (const name of themeVariables) {
      const value = variables[name];
      if (value) this.style.setProperty(`--ck-${name}`, value);
      else this.style.removeProperty(`--ck-${name}`);
    }
    warnIfLowContrast(this, "cheerkit-admin");
  }

  #start() {
    const api = this.getAttribute("api");
    if (!api) return;
    this.#client = createOwnerClient({ api });
    if (!this.#screens.includes(this.#screen)) this.#screen = this.#screens[0]!;
    this.#renderSite();
    void this.#render(true);
  }

  #renderSite() {
    const text = this.#text;
    const logo = safeImage(this.#config.logo);
    const name = h(
      "div",
      {},
      h("strong", {}, this.#config.siteName ?? text.adminLabel),
      this.#config.siteName ? h("span", {}, text.adminLabel) : null,
    );
    this.#site.replaceChildren(
      ...(logo
        ? [h("img", { src: logo, alt: "", referrerpolicy: "no-referrer" })]
        : []),
      name,
    );
  }

  #label(screen: Screen) {
    const text = this.#text;
    return {
      contributions: text.navContributions,
      notices: text.navNotices,
      contexts: text.navContexts,
      effects: text.navEffects,
      export: text.navExport,
    }[screen];
  }

  #renderNav() {
    const summary = this.#summary;
    const counts: Partial<Record<Screen, number>> = summary
      ? {
          notices: summary.events.review + summary.events.pending,
          effects: summary.effects.failed,
        }
      : {};
    this.#nav.replaceChildren(
      ...this.#screens.map((screen) => {
        const button = h(
          "button",
          {
            type: "button",
            "aria-current": screen === this.#screen ? "page" : undefined,
          },
          icon(screenIcons[screen], 17),
          this.#label(screen),
          counts[screen]
            ? h("span", { class: "count" }, String(counts[screen]))
            : null,
        );
        button.addEventListener("click", () => this.#go(screen));
        return button;
      }),
    );
    this.#navSelect.replaceChildren(
      ...this.#screens.map(
        (screen) =>
          new Option(
            counts[screen]
              ? `${this.#label(screen)} (${counts[screen]})`
              : this.#label(screen),
            screen,
            false,
            screen === this.#screen,
          ),
      ),
    );
    this.#navSelect.setAttribute("aria-label", this.#text.show);
  }

  #go(screen: Screen) {
    if (screen === this.#screen) return;
    this.#screen = screen;
    this.#status = "";
    this.#cursors = [null];
    void this.#render(true).then(() =>
      this.#main.querySelector<HTMLElement>(".page-title")?.focus(),
    );
  }

  #errorText(error: unknown) {
    const code =
      error instanceof OwnerRequestError ? error.code : "server_error";
    return (
      (this.#text as Record<string, string>)[`error_${code}`] ??
      this.#text.error_default
    );
  }

  #money(amount: string, currency: string) {
    return formatMoney(amount, currency, this.#config.locale);
  }

  #when(iso: string) {
    try {
      return new Intl.DateTimeFormat(this.#config.locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  #head(title: string, sub: string, extra?: Child) {
    return h(
      "div",
      { class: "page-head" },
      h("h1", { class: "page-title", tabindex: "-1" }, title),
      h("p", { class: "page-sub" }, sub),
      extra,
    );
  }

  #stateView(
    tone: string,
    iconName: string,
    title: string,
    body: string,
    action?: [string, () => void],
    slot?: boolean,
  ) {
    const button = action
      ? h("button", { type: "button", class: "small" }, action[0])
      : null;
    if (button && action) button.addEventListener("click", action[1]);
    return h(
      "div",
      { class: "state", role: tone === "danger" ? "alert" : "status" },
      h("div", { class: "status-icon", "data-tone": tone }, icon(iconName, 22)),
      h("strong", {}, title),
      h("p", {}, body),
      button,
      slot
        ? h("div", { class: "slot-wrap" }, h("slot", { name: "sign-in" }))
        : null,
    );
  }

  async #render(showLoading: boolean) {
    const client = this.#client;
    if (!client) return;
    this.#renderNav();
    if (showLoading)
      this.#main.replaceChildren(
        this.#head(this.#label(this.#screen), ""),
        h(
          "div",
          { class: "panel skeleton", "aria-busy": "true" },
          ...[0, 1, 2, 3, 4].map(() =>
            h(
              "div",
              {},
              h("span", { class: "w1" }),
              h("span", { class: "w2" }),
              h("span", { class: "w3" }),
            ),
          ),
        ),
      );
    try {
      [this.#summary, this.#contexts] = await Promise.all([
        client.summary(),
        client.listContexts(),
      ]);
      this.#renderNav();
      const view = await this.#screenView(client);
      this.#main.replaceChildren(...view);
    } catch (error) {
      const text = this.#text;
      if (
        error instanceof OwnerRequestError &&
        (error.status === 401 || error.status === 403)
      )
        this.#main.replaceChildren(
          this.#stateView(
            "muted",
            "lock",
            text.signedOutTitle,
            text.signedOutBody,
            undefined,
            true,
          ),
        );
      else
        this.#main.replaceChildren(
          this.#stateView(
            "danger",
            "wifiOff",
            text.errorTitle,
            this.#errorText(error),
            [text.tryAgain, () => void this.#render(true)],
          ),
        );
    }
  }

  async #screenView(client: OwnerClient): Promise<HTMLElement[]> {
    switch (this.#screen) {
      case "contributions":
        return this.#contributionsView(client);
      case "notices":
        return this.#noticesView(client);
      case "contexts":
        return [
          this.#head(this.#text.navContexts, this.#text.contextsSub),
          this.#contextsView(client),
        ];
      case "effects":
        return this.#effectsView(client);
      case "export":
        return [
          this.#head(this.#text.navExport, this.#text.exportSub),
          this.#exportView(client),
        ];
    }
  }

  #filters<T extends string>(
    entries: readonly [T, string, number][],
    current: T,
    choose: (value: T) => void,
  ) {
    return h(
      "div",
      { class: "filters", role: "group", "aria-label": this.#text.show },
      ...entries.map(([value, label, count]) => {
        const button = h(
          "button",
          {
            type: "button",
            class: "filter",
            "aria-pressed": value === current ? "true" : "false",
          },
          label,
          h("span", {}, String(count)),
        );
        button.addEventListener("click", () => choose(value));
        return button;
      }),
    );
  }

  #statusLabel(status: ContributionStatus) {
    const text = this.#text;
    return {
      confirmed: text.statusConfirmed,
      needs_review: text.statusNeedsReview,
      awaiting_payment: text.statusAwaiting,
      checkout_unresolved: text.statusUnresolved,
      unsuccessful: text.statusUnsuccessful,
    }[status];
  }

  #from(contribution: StoredContribution): HTMLElement {
    const name = contribution.intent.supporterName;
    if (name) return h("span", {}, name);
    return h(
      "span",
      { class: "anonymous" },
      contribution.personalDataRemoved
        ? this.#text.removed
        : this.#text.anonymous,
    );
  }

  #contextName(id: string) {
    return (
      this.#contexts.find((entry) => entry.context.id === id)?.context.name ??
      id
    );
  }

  async #contributionsView(client: OwnerClient): Promise<HTMLElement[]> {
    const text = this.#text;
    const summary = this.#summary!;
    const pageSize = this.#config.pageSize ?? 25;
    const cursor = this.#cursors.at(-1) ?? null;
    const page = await client.listContributions({
      ...(this.#status ? { status: this.#status } : {}),
      ...(cursor ? { before: cursor } : {}),
      limit: pageSize,
    });
    const total = statusOrder.reduce(
      (sum, status) => sum + summary.contributions[status],
      0,
    );
    const totals = Object.entries(summary.confirmedTotals);
    const stat = (label: string, values: string[], note: string) =>
      h(
        "div",
        { class: "stat", part: "stat" },
        h("span", { class: "stat-label" }, label),
        h(
          "div",
          { class: "stat-values" },
          ...values.map((value) => h("span", { class: "stat-value" }, value)),
        ),
        h("span", { class: "stat-note" }, note),
      );
    const stats = h(
      "div",
      { class: "stats" },
      stat(
        text.confirmedSupport,
        totals.length
          ? totals.map(([currency, amount]) => this.#money(amount, currency))
          : ["0"],
        text.confirmedSupportNote,
      ),
      stat(
        text.confirmedCount,
        [String(summary.contributions.confirmed)],
        fill(text.confirmedCountNote, { total: String(total) }),
      ),
      stat(
        text.reviewCount,
        [String(summary.contributions.needs_review)],
        text.reviewCountNote,
      ),
      summary.openDisputes > 0
        ? stat(text.disputes, [String(summary.openDisputes)], text.disputesNote)
        : null,
    );
    const filters = this.#filters<ContributionStatus | "">(
      [
        ["", text.all, total],
        ...statusOrder.map(
          (status) =>
            [
              status,
              this.#statusLabel(status),
              summary.contributions[status],
            ] as [ContributionStatus, string, number],
        ),
      ],
      this.#status,
      (value) => {
        this.#status = value;
        this.#cursors = [null];
        void this.#render(false);
      },
    );
    let body: HTMLElement;
    if (!page.length) {
      body = this.#status
        ? this.#stateView(
            "muted",
            "check",
            text.emptyFiltered,
            text.emptyFilteredBody,
            [
              text.showAll,
              () => {
                this.#status = "";
                void this.#render(false);
              },
            ],
          )
        : this.#stateView("muted", "receipt", text.emptyAll, text.emptyAllBody);
    } else {
      body = h(
        "table",
        { class: "responsive", part: "table" },
        h("caption", { class: "visually-hidden" }, text.navContributions),
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col" }, text.when),
            h("th", { scope: "col", class: "num" }, text.amount),
            h("th", { scope: "col" }, text.from),
            h("th", { scope: "col" }, text.context),
            h("th", { scope: "col" }, text.status),
            h(
              "th",
              { scope: "col" },
              h("span", { class: "visually-hidden" }, text.open),
            ),
          ),
        ),
        h(
          "tbody",
          {},
          ...page.map((contribution) => {
            const { intent } = contribution;
            const amount = this.#money(intent.amount, intent.currency);
            const when = this.#when(intent.createdAt);
            const open = h(
              "button",
              {
                type: "button",
                class: "small",
                "aria-label": fill(text.openLabel, { amount, when }),
              },
              text.open,
            );
            open.addEventListener(
              "click",
              () => void this.#openDetail(intent.id),
            );
            return h(
              "tr",
              { part: "row" },
              h(
                "td",
                {
                  class: "muted",
                  "data-label": text.when,
                  title: intent.createdAt,
                },
                when,
              ),
              h("td", { class: "num", "data-label": text.amount }, amount),
              h("td", { "data-label": text.from }, this.#from(contribution)),
              h(
                "td",
                { class: "muted", "data-label": text.context },
                this.#contextName(intent.contextId),
              ),
              h(
                "td",
                { "data-label": text.status },
                h(
                  "span",
                  {
                    class: "dot",
                    "data-tone": statusTone[contribution.status] || undefined,
                  },
                  this.#statusLabel(contribution.status),
                ),
              ),
              h("td", { class: "end" }, open),
            );
          }),
        ),
      );
    }
    const newer = h(
      "button",
      { type: "button", class: "small" },
      text.newer,
    ) as HTMLButtonElement;
    const older = h(
      "button",
      { type: "button", class: "small" },
      text.older,
    ) as HTMLButtonElement;
    newer.disabled = this.#cursors.length === 1;
    older.disabled = page.length < pageSize;
    newer.addEventListener("click", () => {
      this.#cursors.pop();
      void this.#render(false);
    });
    older.addEventListener("click", () => {
      const last = page.at(-1)?.intent;
      if (!last) return;
      this.#cursors.push({ createdAt: last.createdAt, id: last.id });
      void this.#render(false);
    });
    return [
      this.#head(text.navContributions, text.contributionsSub),
      stats,
      h("div", { class: "panel" }, filters, body),
      h(
        "div",
        { class: "pager" },
        h("span", {}, fill(text.showing, { count: String(page.length) })),
        h("div", {}, newer, older),
      ),
    ];
  }

  async #openDetail(id: string, message?: [string, string]) {
    const client = this.#client!;
    try {
      const [contribution, events] = await Promise.all([
        client.getContribution(id),
        client.listEvents({ contributionId: id }),
      ]);
      this.#drawer.replaceChildren(
        this.#detailView(contribution, events, message),
      );
      if (!this.#drawer.open) this.#drawer.showModal();
      this.#drawer.querySelector<HTMLElement>(".drawer-title")?.focus();
    } catch (error) {
      this.#drawer.replaceChildren(
        h(
          "div",
          { class: "drawer-body" },
          this.#banner(
            "danger",
            "alert",
            this.#text.errorTitle,
            this.#errorText(error),
          ),
        ),
      );
      if (!this.#drawer.open) this.#drawer.showModal();
    }
  }

  #banner(
    tone: string,
    iconName: string,
    title: string,
    body?: string,
    action?: HTMLElement,
  ) {
    return h(
      "div",
      {
        class: "banner",
        "data-tone": tone,
        role: tone === "danger" ? "alert" : "status",
      },
      icon(iconName, 18),
      h(
        "div",
        {},
        title ? h("strong", {}, title) : null,
        body ? h("p", {}, body) : null,
      ),
      action,
    );
  }

  #detailView(
    contribution: StoredContribution,
    events: StoredEvent[],
    message?: [string, string],
  ) {
    const text = this.#text;
    const client = this.#client!;
    const { intent } = contribution;
    const id = intent.id;
    const close = h(
      "button",
      { type: "button", class: "close", "aria-label": text.close },
      icon("x", 18),
    );
    close.addEventListener("click", () => this.#drawer.close());

    const run = async (
      work: () => Promise<unknown>,
      button: HTMLElement,
      success = text.done,
    ) => {
      button.setAttribute("disabled", "");
      try {
        await work();
        await this.#openDetail(id, ["success", success]);
        void this.#render(false);
      } catch (error) {
        button.removeAttribute("disabled");
        await this.#openDetail(id, ["danger", this.#errorText(error)]);
      }
    };

    const kv = (rows: [string, Child][]) =>
      h(
        "dl",
        { class: "kv" },
        ...rows.map(([term, value]) =>
          h("div", {}, h("dt", {}, term), h("dd", {}, value)),
        ),
      );

    const sections: Child[] = [];
    if (message)
      sections.push(
        this.#banner(
          message[0],
          message[0] === "success" ? "check" : "alert",
          message[1],
        ),
      );

    const reviewEvent = events.find((stored) => stored.state === "review");
    if (contribution.status === "needs_review")
      sections.push(
        this.#banner(
          "warning",
          "alert",
          text.reviewTitle,
          fill(text.reviewBody, {
            reason: reviewEvent?.reason
              ? words(reviewEvent.reason).toLowerCase()
              : text.none.toLowerCase(),
          }),
        ),
      );

    if (contribution.payments.length) {
      const rows: [string, Child][] = [];
      for (const payment of contribution.payments) {
        const fee =
          payment.fee.state === "charged"
            ? fill(text.fee, {
                amount: this.#money(payment.fee.amount, payment.fee.currency),
              })
            : payment.fee.state === "none"
              ? text.feeNone
              : text.feeUnreported;
        rows.push([
          fill(text.charge, { id: `…${payment.chargeId.slice(-4)}` }),
          `${this.#money(payment.amount, payment.currency)} · ${fee}`,
        ]);
        if (
          payment.statement &&
          payment.statement.currency !== payment.currency
        )
          rows.push([
            text.supporterCharged,
            this.#money(payment.statement.amount, payment.statement.currency),
          ]);
        rows.push([
          text.settlement,
          payment.settlement
            ? this.#money(
                payment.settlement.amount,
                payment.settlement.currency,
              )
            : h("span", { class: "anonymous" }, text.settlementMissing),
        ]);
        for (const refund of payment.refunds)
          rows.push([
            text.refund,
            `${this.#money(refund.refundedAmount, payment.currency)} · ${words(refund.status)}`,
          ]);
        for (const dispute of payment.disputes)
          rows.push([text.dispute, words(dispute.status)]);
      }
      sections.push(
        h(
          "section",
          { class: "section" },
          h("h3", { class: "section-title" }, text.payments),
          kv(rows),
        ),
      );
    }

    if (intent.message)
      sections.push(
        h(
          "section",
          { class: "section" },
          h("h3", { class: "section-title" }, text.message),
          h("p", { class: "message-text" }, `“${intent.message}”`),
        ),
      );

    if (contribution.ownerRecords.length)
      sections.push(
        h(
          "section",
          { class: "section" },
          h("h3", { class: "section-title" }, text.records),
          kv(
            contribution.ownerRecords.map((record) => [
              record.kind === "external_return" ? text.returned : text.accepted,
              `${record.amount && record.currency ? `${this.#money(record.amount, record.currency)} · ` : ""}${record.note}`,
            ]),
          ),
        ),
      );

    const noteField = (idSuffix: string) => {
      const input = h("textarea", {
        class: "input",
        id: `ck-note-${idSuffix}`,
        name: "note",
        rows: "2",
        required: true,
        maxlength: "2000",
        placeholder: text.notePlaceholder,
      }) as HTMLTextAreaElement;
      return [
        input,
        h(
          "div",
          { class: "field" },
          h(
            "label",
            { class: "label", for: `ck-note-${idSuffix}` },
            text.note,
            h("span", { class: "optional" }, text.required),
          ),
          input,
        ),
      ] as const;
    };

    if (contribution.payments.length) {
      const [note, noteBlock] = noteField("decision");
      const amount = h("input", {
        class: "input",
        id: "ck-return-amount",
        inputmode: "decimal",
        autocomplete: "off",
        placeholder: intent.currency,
      }) as HTMLInputElement;
      const buttons: HTMLElement[] = [];
      if (contribution.status === "needs_review") {
        const accept = h(
          "button",
          { type: "button", class: "button" },
          text.acceptConfirm,
        );
        accept.addEventListener("click", () => {
          if (!note.reportValidity()) return;
          void run(() => client.acceptReview(id, note.value.trim()), accept);
        });
        buttons.push(accept);
      }
      const record = h(
        "button",
        { type: "button", class: "button-secondary" },
        text.recordReturn,
      );
      record.addEventListener("click", () => {
        if (!note.reportValidity()) return;
        if (!amount.value.trim()) {
          amount.focus();
          return;
        }
        void run(
          () =>
            client.recordExternalReturn(
              id,
              amount.value.trim(),
              note.value.trim(),
            ),
          record,
        );
      });
      buttons.push(record);
      sections.push(
        h(
          "section",
          { class: "section action-form" },
          h("h3", { class: "section-title" }, text.decision),
          noteBlock,
          h(
            "div",
            { class: "field" },
            h(
              "label",
              { class: "label", for: "ck-return-amount" },
              text.returnAmount,
              h("span", { class: "optional" }, intent.currency),
            ),
            amount,
          ),
          h("div", { class: "row" }, ...buttons),
        ),
      );
    }

    if (contribution.status === "checkout_unresolved") {
      const retry = h(
        "button",
        { type: "button", class: "button-secondary" },
        text.retryCheckout,
      );
      retry.addEventListener(
        "click",
        () => void run(() => client.retryCheckout(id), retry),
      );
      const checkoutId = h("input", {
        class: "input",
        id: "ck-checkout-id",
        autocomplete: "off",
      }) as HTMLInputElement;
      const recover = h(
        "button",
        { type: "button", class: "button-secondary" },
        text.recover,
      );
      recover.addEventListener("click", () => {
        if (!checkoutId.value.trim()) {
          checkoutId.focus();
          return;
        }
        void run(
          () => client.recoverCheckout(id, checkoutId.value.trim()),
          recover,
        );
      });
      sections.push(
        h(
          "section",
          { class: "section action-form" },
          h("h3", { class: "section-title" }, text.checkout),
          retry,
          h(
            "div",
            { class: "field" },
            h(
              "label",
              { class: "label", for: "ck-checkout-id" },
              text.recoverTitle,
            ),
            h("div", { class: "row" }, checkoutId, recover),
            h("span", { class: "hint" }, text.recoverHint),
          ),
        ),
      );
    }

    const more: HTMLElement[] = [];
    for (const stored of events.filter(
      (entry) => entry.state === "review" || entry.state === "dismissed",
    )) {
      const recheck = h(
        "button",
        { type: "button", class: "small" },
        `${text.recheck}: ${words(stored.event.type)}`,
      );
      recheck.addEventListener(
        "click",
        () => void run(() => client.recheckEvent(stored.event.id), recheck),
      );
      more.push(recheck);
    }
    if (contribution.payments.length) {
      const refresh = h(
        "button",
        { type: "button", class: "small" },
        icon("refresh", 15),
        text.refreshDetails,
      );
      refresh.addEventListener(
        "click",
        () => void run(() => client.refreshPaymentDetails(id), refresh),
      );
      more.push(refresh);
      if (
        contribution.payments.some(
          (payment) =>
            !payment.settlement || payment.fee.state === "unreported",
        )
      ) {
        const resend = h(
          "button",
          { type: "button", class: "small" },
          icon("send", 15),
          text.resendNotices,
        );
        resend.addEventListener(
          "click",
          () => void run(() => client.resendNotices(id), resend),
        );
        more.push(resend);
      }
    }
    if (intent.supporterName || intent.message) {
      const remove = h(
        "button",
        { type: "button", class: "small" },
        icon("user", 15),
        text.removeData,
      );
      remove.addEventListener("click", async () => {
        const confirmed = await this.#confirm(
          fill(text.removeTitle, {
            name: intent.supporterName ?? text.anonymous,
          }),
          text.removeBody,
          text.removeKeep,
          text.removeData,
        );
        if (confirmed) void run(() => client.removePersonalData(id), remove);
      });
      more.push(remove);
    }
    if (more.length)
      sections.push(
        h(
          "section",
          { class: "section" },
          h("h3", { class: "section-title" }, text.more),
          h("div", { class: "links" }, ...more),
        ),
      );

    return h(
      "div",
      {},
      h(
        "div",
        { class: "drawer-head" },
        h(
          "div",
          {},
          h(
            "h2",
            { class: "drawer-title", id: "ck-drawer-title", tabindex: "-1" },
            this.#money(intent.amount, intent.currency),
          ),
          h(
            "div",
            { class: "drawer-meta" },
            h(
              "span",
              {
                class: "dot",
                "data-tone": statusTone[contribution.status] || undefined,
              },
              this.#statusLabel(contribution.status),
            ),
            this.#from(contribution),
            h("span", {}, this.#contextName(intent.contextId)),
            h(
              "span",
              {},
              fill(text.started, { when: this.#when(intent.createdAt) }),
            ),
          ),
        ),
        close,
      ),
      h(
        "div",
        { class: "drawer-body" },
        ...(sections.length
          ? sections
          : [h("p", { class: "muted" }, text.nothingToDo)]),
      ),
    );
  }

  #confirm(
    title: string,
    body: string,
    cancel: string,
    confirm: string,
    withNote = false,
  ): Promise<string | false> {
    const text = this.#text;
    return new Promise((resolve) => {
      const note = withNote
        ? (h("textarea", {
            class: "input",
            id: "ck-modal-note",
            rows: "2",
            required: true,
            maxlength: "2000",
            placeholder: text.notePlaceholder,
          }) as HTMLTextAreaElement)
        : null;
      const cancelButton = h(
        "button",
        { type: "button", class: "button-secondary" },
        cancel,
      );
      const confirmButton = h(
        "button",
        { type: "submit", class: "button button-danger" },
        confirm,
      );
      const form = h(
        "form",
        { method: "dialog" },
        h("h2", { id: "ck-modal-title", tabindex: "-1" }, title),
        h("p", {}, body),
        note
          ? h(
              "div",
              { class: "field" },
              h(
                "label",
                { class: "label", for: "ck-modal-note" },
                text.note,
                h("span", { class: "optional" }, text.required),
              ),
              note,
            )
          : null,
        h("div", { class: "row" }, cancelButton, confirmButton),
      );
      let result: string | false = false;
      form.addEventListener("submit", (event) => {
        if (note && !note.value.trim()) {
          event.preventDefault();
          note.focus();
          return;
        }
        result = note ? note.value.trim() : "confirmed";
      });
      cancelButton.addEventListener("click", () => this.#modal.close());
      this.#modal.addEventListener("close", () => resolve(result), {
        once: true,
      });
      this.#modal.replaceChildren(form);
      this.#modal.showModal();
      (note ?? cancelButton).focus();
    });
  }

  async #noticesView(client: OwnerClient): Promise<HTMLElement[]> {
    const text = this.#text;
    const summary = this.#summary!;
    const labels: Record<StoredEvent["state"], string> = {
      review: text.stateReview,
      pending: text.statePending,
      unsupported: text.stateUnsupported,
      dismissed: text.stateDismissed,
      applied: text.stateApplied,
    };
    const events = await client.listEvents({
      state: this.#eventState,
      limit: 100,
    });
    const filters = this.#filters(
      eventStates.map(
        (state) =>
          [state, labels[state], summary.events[state]] as [
            StoredEvent["state"],
            string,
            number,
          ],
      ),
      this.#eventState,
      (value) => {
        this.#eventState = value;
        void this.#render(false);
      },
    );
    const act = async (button: HTMLElement, work: () => Promise<unknown>) => {
      button.setAttribute("disabled", "");
      try {
        await work();
        await this.#render(false);
      } catch (error) {
        button.removeAttribute("disabled");
        button
          .closest("td")
          ?.append(
            h("p", { class: "notice", role: "alert" }, this.#errorText(error)),
          );
      }
    };
    const field = (data: Record<string, unknown>, key: string) =>
      typeof data[key] === "string" ? (data[key] as string) : null;
    const body = events.length
      ? h(
          "table",
          { class: "responsive", part: "table" },
          h("caption", { class: "visually-hidden" }, text.navNotices),
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              ...[text.received, text.notice, text.amount, text.why].map(
                (label, index) =>
                  h(
                    "th",
                    { scope: "col", class: index === 2 ? "num" : undefined },
                    label,
                  ),
              ),
              h(
                "th",
                { scope: "col" },
                h("span", { class: "visually-hidden" }, text.action),
              ),
            ),
          ),
          h(
            "tbody",
            {},
            ...events.map((stored) => {
              const data = stored.event.data;
              const amount = field(data, "amount");
              const currency = field(data, "currency");
              const actions = h("td", { class: "end" });
              const button = (label: string, work: () => Promise<unknown>) => {
                const element = h(
                  "button",
                  { type: "button", class: "small" },
                  label,
                );
                element.addEventListener(
                  "click",
                  () => void act(element, work),
                );
                actions.append(element);
              };
              if (
                stored.state === "review" ||
                stored.state === "pending" ||
                stored.state === "dismissed"
              )
                button(text.recheck, () =>
                  client.recheckEvent(stored.event.id),
                );
              if (stored.state === "dismissed")
                button(text.reopen, () => client.reopenEvent(stored.event.id));
              if (
                stored.state === "review" ||
                stored.state === "pending" ||
                stored.state === "unsupported"
              ) {
                const dismiss = h(
                  "button",
                  { type: "button", class: "small" },
                  text.dismiss,
                );
                dismiss.addEventListener("click", async () => {
                  const note = await this.#confirm(
                    text.dismissTitle,
                    text.dismissBody,
                    text.removeKeep,
                    text.dismiss,
                    true,
                  );
                  if (note)
                    void act(dismiss, () =>
                      client.dismissEvent(stored.event.id, note),
                    );
                });
                actions.append(dismiss);
              }
              return h(
                "tr",
                {},
                h(
                  "td",
                  { class: "muted", "data-label": text.received },
                  this.#when(stored.event.createdAt),
                ),
                h(
                  "td",
                  { "data-label": text.notice },
                  words(stored.event.type),
                ),
                h(
                  "td",
                  { class: "num", "data-label": text.amount },
                  amount && currency
                    ? this.#money(amount, currency)
                    : h("span", { class: "anonymous" }, text.none),
                ),
                h(
                  "td",
                  { "data-label": text.why },
                  stored.reason
                    ? words(stored.reason)
                    : (stored.note ??
                        h("span", { class: "anonymous" }, text.none)),
                ),
                actions,
              );
            }),
          ),
        )
      : this.#stateView(
          "muted",
          "inbox",
          text.emptyNotices,
          text.emptyNoticesBody,
        );
    return [
      this.#head(text.navNotices, text.noticesSub),
      h("div", { class: "panel" }, filters, body),
    ];
  }

  #contextsView(client: OwnerClient): HTMLElement {
    const text = this.#text;
    const contexts = this.#contexts;
    if (!contexts.length)
      return this.#stateView("muted", "sliders", text.emptyFiltered, "");
    const selected =
      contexts.find((entry) => entry.context.id === this.#contextId) ??
      contexts[0]!;
    this.#contextId = selected.context.id;
    const list = h(
      "div",
      { class: "context-list" },
      ...contexts.map(({ context }) => {
        const button = h(
          "button",
          {
            type: "button",
            class: "context-item",
            "aria-current":
              context.id === selected.context.id ? "true" : "false",
          },
          h("strong", {}, context.name),
          h(
            "span",
            {
              class: "dot muted",
              "data-tone": context.acceptingContributions
                ? "success"
                : undefined,
            },
            `${context.acceptingContributions ? text.taking : text.paused} · ${context.currencies.map((rules) => rules.currency).join(", ")}`,
          ),
        );
        button.addEventListener("click", () => {
          this.#contextId = context.id;
          void this.#render(false);
        });
        return button;
      }),
    );
    return h("div", { class: "columns" }, list, this.#editor(client, selected));
  }

  #editor(client: OwnerClient, stored: StoredContext): HTMLElement {
    const text = this.#text;
    const { context, revision } = stored;
    const status = h("div", {});
    const plain = (amount: string) => amount.replace(/\.0+$/, "");
    const input = (value: string, label: string, idValue: string) =>
      h("input", {
        class: "input",
        id: idValue,
        value,
        autocomplete: "off",
        inputmode: "decimal",
        "aria-label": label,
      }) as HTMLInputElement;
    const accepting = h("input", {
      type: "checkbox",
      id: "ck-accepting",
      checked: context.acceptingContributions,
    }) as HTMLInputElement;
    const name = h("input", {
      class: "input",
      id: "ck-context-name",
      value: context.name,
      maxlength: "120",
    }) as HTMLInputElement;
    const rows = context.currencies.map((rules) => ({
      rules,
      suggested: input(
        rules.suggestedAmounts.map(plain).join(", "),
        `${rules.currency} ${text.suggested}`,
        `ck-${rules.currency}-suggested`,
      ),
      minimum: input(
        plain(rules.minimum),
        `${rules.currency} ${text.minimum}`,
        `ck-${rules.currency}-minimum`,
      ),
      maximum: input(
        rules.maximum ? plain(rules.maximum) : "",
        `${rules.currency} ${text.maximum}`,
        `ck-${rules.currency}-maximum`,
      ),
    }));
    const check = (
      idValue: string,
      checked: boolean,
      label: string,
      hint: string,
    ) => {
      const box = h("input", {
        type: "checkbox",
        id: idValue,
        checked,
      }) as HTMLInputElement;
      return [
        box,
        h(
          "label",
          { class: "check", for: idValue },
          box,
          h("span", {}, label, h("small", {}, hint)),
        ),
      ] as const;
    };
    const [collectName, collectNameRow] = check(
      "ck-collect-name",
      context.collectName,
      text.collectName,
      text.collectNameHint,
    );
    const [collectMessage, collectMessageRow] = check(
      "ck-collect-message",
      context.collectMessage,
      text.collectMessage,
      text.collectMessageHint,
    );
    const save = h(
      "button",
      { type: "submit", class: "button" },
      text.saveChanges,
    );
    const form = h(
      "form",
      { class: "panel editor", part: "editor", novalidate: true },
      status,
      h(
        "div",
        { class: "editor-head" },
        h("h2", {}, context.name),
        h(
          "label",
          { class: "check", for: "ck-accepting" },
          accepting,
          h("span", {}, text.taking),
        ),
      ),
      h(
        "div",
        { class: "field" },
        h("label", { class: "label", for: "ck-context-name" }, text.name),
        name,
      ),
      h(
        "div",
        { class: "currency-rows" },
        h(
          "div",
          { class: "currency-row head" },
          h("span", {}, text.currency),
          h(
            "span",
            {},
            `${text.suggested} (${text.suggestedHint.toLowerCase()})`,
          ),
          h("span", {}, text.minimum),
          h("span", {}, text.maximum),
        ),
        ...rows.map((row) =>
          h(
            "div",
            { class: "currency-row" },
            h("strong", {}, row.rules.currency),
            row.suggested,
            row.minimum,
            row.maximum,
          ),
        ),
      ),
      h(
        "div",
        { class: "section" },
        h("h3", { class: "section-title" }, text.supporterFields),
        collectNameRow,
        collectMessageRow,
      ),
      h("div", { class: "editor-foot" }, h("span", {}, text.editorFoot), save),
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.setAttribute("disabled", "");
      const amounts = (value: string) =>
        value
          .split(",")
          .map((part) => part.trim().replace(/\s/g, ""))
          .filter(Boolean);
      try {
        const updated = await client.putContext(
          {
            id: context.id,
            name: name.value.trim(),
            acceptingContributions: accepting.checked,
            collectName: collectName.checked,
            collectMessage: collectMessage.checked,
            currencies: rows.map(({ rules, suggested, minimum, maximum }) => ({
              currency: rules.currency,
              fractionDigits: rules.fractionDigits,
              minimum: minimum.value.trim(),
              ...(maximum.value.trim()
                ? { maximum: maximum.value.trim() }
                : {}),
              suggestedAmounts: amounts(suggested.value),
            })),
          },
          revision,
        );
        this.#contexts = this.#contexts.map((entry) =>
          entry.context.id === updated.context.id ? updated : entry,
        );
        this.#main.replaceChildren(
          this.#head(text.navContexts, text.contextsSub),
          this.#contextsView(client),
        );
        this.#main
          .querySelector(".editor > div")
          ?.replaceChildren(this.#banner("success", "check", text.saved));
      } catch (error) {
        save.removeAttribute("disabled");
        if (error instanceof OwnerRequestError && error.code === "conflict") {
          const reload = h(
            "button",
            { type: "button", class: "small" },
            text.loadLatest,
          );
          reload.addEventListener("click", () => void this.#render(false));
          status.replaceChildren(
            this.#banner(
              "warning",
              "merge",
              text.conflictTitle,
              text.conflictBody,
              reload,
            ),
          );
        } else
          status.replaceChildren(
            this.#banner("danger", "alert", this.#errorText(error)),
          );
        status
          .querySelector<HTMLElement>(".banner")
          ?.scrollIntoView({ block: "nearest" });
      }
    });
    return form;
  }

  async #effectsView(client: OwnerClient): Promise<HTMLElement[]> {
    const text = this.#text;
    const summary = this.#summary!;
    const labels: Record<StoredEffect["state"], string> = {
      failed: text.effectFailed,
      pending: text.effectPending,
      running: text.effectRunning,
      succeeded: text.effectSucceeded,
    };
    const tones: Record<StoredEffect["state"], string> = {
      failed: "danger",
      pending: "warning",
      running: "warning",
      succeeded: "success",
    };
    const effects = await client.listEffects({
      state: this.#effectState,
      limit: 100,
    });
    const filters = this.#filters(
      effectStates.map(
        (state) =>
          [state, labels[state], summary.effects[state]] as [
            StoredEffect["state"],
            string,
            number,
          ],
      ),
      this.#effectState,
      (value) => {
        this.#effectState = value;
        void this.#render(false);
      },
    );
    const body = effects.length
      ? h(
          "table",
          { class: "responsive", part: "table" },
          h("caption", { class: "visually-hidden" }, text.navEffects),
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              ...[
                text.contribution,
                text.action,
                text.status,
                text.attemptsCount,
                text.lastProblem,
              ].map((label, index) =>
                h(
                  "th",
                  { scope: "col", class: index === 3 ? "num" : undefined },
                  label,
                ),
              ),
              h(
                "th",
                { scope: "col" },
                h("span", { class: "visually-hidden" }, text.retry),
              ),
            ),
          ),
          h(
            "tbody",
            {},
            ...effects.map((effect) => {
              const actions = h("td", { class: "end" });
              const open = h(
                "button",
                { type: "button", class: "small" },
                text.open,
              );
              open.addEventListener(
                "click",
                () => void this.#openDetail(effect.contributionId),
              );
              actions.append(open);
              if (effect.state === "failed") {
                const retry = h(
                  "button",
                  { type: "button", class: "small" },
                  text.retry,
                );
                retry.addEventListener("click", async () => {
                  retry.setAttribute("disabled", "");
                  try {
                    await client.retryEffect(
                      effect.contributionId,
                      effect.name,
                    );
                    await this.#render(false);
                  } catch (error) {
                    retry.removeAttribute("disabled");
                    actions.append(
                      h(
                        "p",
                        { class: "notice", role: "alert" },
                        this.#errorText(error),
                      ),
                    );
                  }
                });
                actions.append(retry);
              }
              return h(
                "tr",
                {},
                h(
                  "td",
                  { class: "muted", "data-label": text.contribution },
                  `…${effect.contributionId.slice(-6)}`,
                ),
                h("td", { "data-label": text.action }, words(effect.name)),
                h(
                  "td",
                  { "data-label": text.status },
                  h(
                    "span",
                    { class: "dot", "data-tone": tones[effect.state] },
                    labels[effect.state],
                  ),
                ),
                h(
                  "td",
                  { class: "num", "data-label": text.attemptsCount },
                  String(effect.attempts),
                ),
                h(
                  "td",
                  { "data-label": text.lastProblem },
                  effect.lastError
                    ? words(effect.lastError)
                    : h("span", { class: "anonymous" }, text.none),
                ),
                actions,
              );
            }),
          ),
        )
      : this.#stateView(
          "muted",
          "zap",
          text.emptyEffects,
          text.emptyEffectsBody,
        );
    return [
      this.#head(text.navEffects, text.effectsSub),
      h("div", { class: "panel" }, filters, body),
    ];
  }

  #exportView(client: OwnerClient): HTMLElement {
    const text = this.#text;
    const status = h("div", {});
    const download = h(
      "button",
      { type: "button", class: "button" },
      icon("download", 16),
      text.download,
    );
    download.addEventListener("click", async () => {
      download.setAttribute("disabled", "");
      try {
        const data = await client.exportData();
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
        );
        const link = h("a", {
          href: url,
          download: `cheerkit-export-${new Date().toISOString().slice(0, 10)}.json`,
        });
        this.shadowRoot!.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        status.replaceChildren();
      } catch (error) {
        status.replaceChildren(
          this.#banner("danger", "alert", this.#errorText(error)),
        );
      } finally {
        download.removeAttribute("disabled");
      }
    });
    return h(
      "div",
      { class: "panel export" },
      h("h2", { class: "section-title" }, text.exportIncludes),
      h(
        "ul",
        {},
        ...(
          [
            ["receipt", text.exportContributions],
            ["sliders", text.exportContexts],
            ["inbox", text.exportNotices],
            ["user", text.exportPeople],
          ] as const
        ).map(([name, label]) => h("li", {}, icon(name, 17), label)),
      ),
      this.#banner("muted", "shield", "", text.exportPrivacy),
      status,
      download,
    );
  }
}

export function defineCheerkitAdmin() {
  if (!customElements.get("cheerkit-admin"))
    customElements.define("cheerkit-admin", CheerkitAdminElement);
}
