import { readableOn, warnIfLowContrast } from "./color.js";
import { fill, formatMoney, h, icon, safeImage, type Child } from "./dom.js";
import { supportStyles, themeVariables, type ThemeVariable } from "./styles.js";
import {
  createSupport,
  type CurrencyRules,
  type OwnData,
  type PublicContext,
  type PublicContribution,
  type Submission,
  type Support,
  type SupportState,
} from "./support.js";

export const defaultText = {
  close: "Close",
  chooseAmount: "Choose an amount",
  currency: "Currency",
  ownAmount: "Or your own amount",
  ownAmountPlaceholder: "Enter an amount",
  range: "From {minimum} to {maximum}.",
  rangeOpen: "From {minimum}.",
  supporterName: "Your name",
  supporterNamePlaceholder: "Shown with your message",
  supporterNameHint: "Leave empty to stay anonymous.",
  message: "Message",
  messagePlaceholder: "Say something",
  messageHint: "{name} sees this. You can remove it later.",
  optional: "Optional",
  submit: "Support with {amount}",
  submitNoAmount: "Support",
  feesOwner: "Fees covered by {name} · Secure checkout by Bachs",
  feesSupporter:
    "A processing fee is added at checkout · Secure checkout by Bachs",
  feesDefault: "Any fee is shown at checkout · Secure checkout by Bachs",
  loading: "Loading…",
  unavailableTitle: "We couldn't load this",
  closedTitle: "{name} isn't taking support right now",
  closedBody: "Thanks for thinking of it. Check back later.",
  redirectingTitle: "Taking you to checkout",
  redirectingBody:
    "{amount} to {name}, paid securely with Bachs. Keep this window open.",
  checkingTitle: "Checking your payment",
  checkingBody:
    "This usually takes a few seconds. If you close this page, your support still counts once Bachs confirms it.",
  waitingTitle: "Still waiting for confirmation",
  waitingBody:
    "Bachs hasn't confirmed this payment yet. Don't pay again; check back in a little while.",
  checkAgain: "Check again",
  confirmedTitle: "Thank you",
  confirmedBody: "{name} got your support. It means a lot.",
  reviewTitle: "Your payment is being checked",
  reviewBody:
    "Something didn't match, so {name} will look at it. Please don't pay again.",
  refundedTitle: "This payment was refunded",
  refundedBody: "The money goes back to how you paid.",
  unsuccessfulTitle: "Payment didn't go through",
  unsuccessfulBody:
    "You were not charged. Try again, or pick another amount or payment method.",
  tryAgain: "Try again",
  noResultTitle: "Nothing to show here",
  noResultBody: "We couldn't find a payment from this browser tab.",
  amount: "Amount",
  status: "Status",
  statusConfirmed: "Confirmed",
  statusPending: "Waiting for Bachs",
  statusReview: "Being checked",
  statusRefunded: "Refunded",
  statusUnsuccessful: "Not paid",
  yourMessage: "Your message",
  removeData: "Remove my name and message",
  removedData: "Your name and message were removed.",
  owner: "the owner",
  errorChooseAmount: "Choose an amount or enter your own.",
  errorAmountFormat: "Enter the amount as a number, for example 2500 or 25.50.",
  errorAmountRange: "Choose an amount within the range shown.",
  error_network:
    "We couldn't reach the server. Check your connection and try again; you won't be charged twice.",
  error_rate_limited:
    "Too many attempts in a short time. Please wait a minute and try again.",
  error_context_closed: "This isn't accepting support right now.",
  error_amount_out_of_range: "Choose an amount within the range shown.",
  error_invalid_amount:
    "Enter the amount as a number, for example 2500 or 25.50.",
  error_unsupported_currency: "Choose one of the currencies shown.",
  error_invalid_input: "Check the name and message lengths and try again.",
  error_conflict: "This changed while it was being sent. Please try again.",
  error_retry_later: "The server is busy. Please try again shortly.",
  error_default: "Something went wrong on our side. Please try again.",
};

export type SupportText = typeof defaultText;

export interface SupportConfig {
  /** Who is being supported. */
  readonly name?: string;
  /** HTTPS or same-site image URL. */
  readonly avatar?: string;
  readonly tagline?: string;
  readonly title?: string;
  readonly description?: string;
  /** Small notes under the preset amounts, by position (for example "1 coffee"). */
  readonly amountNotes?: readonly string[];
  readonly locale?: string;
  readonly text?: Partial<SupportText>;
  readonly appearance?: {
    readonly variables?: Partial<Record<ThemeVariable, string>>;
  };
  /** Extra data stored with the contribution (bounded and validated by the server). */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

function scaled(amount: string, digits: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match || (match[2]?.length ?? 0) > digits) return null;
  return BigInt(match[1]! + (match[2] ?? "").padEnd(digits, "0"));
}

let sheet: CSSStyleSheet | null = null;

export class CheerkitSupportElement extends HTMLElement {
  static readonly observedAttributes = ["theme", "color"];

  #config: SupportConfig = {};
  #support: Support | null = null;
  #unsubscribe: (() => void) | null = null;
  #watch: AbortController | null = null;
  #dialog: HTMLDialogElement | null = null;
  #container: HTMLElement;
  #form: HTMLFormElement | null = null;
  #rendered = "";
  #ownData: OwnData | null = null;
  #onDocumentClick = (event: MouseEvent) => {
    const opener = (event.target as Element | null)?.closest?.(
      "[data-cheerkit-open]",
    );
    if (!opener) return;
    const target = opener.getAttribute("data-cheerkit-open");
    if (target && target !== this.getAttribute("context")) return;
    event.preventDefault();
    this.open();
  };

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    sheet ??= (() => {
      const created = new CSSStyleSheet();
      created.replaceSync(supportStyles);
      return created;
    })();
    root.adoptedStyleSheets = [sheet];
    this.#container = h("div");
    root.append(this.#container);
  }

  get config(): SupportConfig {
    return this.#config;
  }

  set config(value: SupportConfig) {
    this.#config = value ?? {};
    this.#applyAppearance();
    if (this.isConnected) this.#start();
  }

  get #text(): SupportText {
    return { ...defaultText, ...this.#config.text };
  }

  get #name(): string {
    return this.#config.name ?? this.#text.owner;
  }

  get #layout(): "page" | "dialog" | "inline" {
    const value = this.getAttribute("layout");
    return value === "dialog" || value === "inline" ? value : "page";
  }

  connectedCallback() {
    this.#start();
    document.addEventListener("click", this.#onDocumentClick);
    addEventListener("pageshow", this.#onPageShow);
  }

  disconnectedCallback() {
    document.removeEventListener("click", this.#onDocumentClick);
    removeEventListener("pageshow", this.#onPageShow);
    this.#stop();
  }

  attributeChangedCallback() {
    this.#applyAppearance();
  }

  /** Opens the dialog layout; other layouts are always visible. */
  open() {
    if (!this.#dialog) return;
    if (!this.#dialog.open) this.#dialog.showModal();
  }

  close() {
    this.#dialog?.close();
  }

  #onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) this.#start();
  };

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
    warnIfLowContrast(this, "cheerkit-support");
  }

  #stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#watch?.abort();
    this.#watch = null;
  }

  #start() {
    const api = this.getAttribute("api");
    const contextId = this.getAttribute("context");
    if (!api || !contextId) return;
    this.#stop();
    this.#rendered = "";
    this.#ownData = null;
    this.#support = createSupport({
      api,
      contextId,
      ...(this.#config.metadata ? { metadata: this.#config.metadata } : {}),
    });
    this.#unsubscribe = this.#support.subscribe((state) => this.#update(state));
    this.#buildFrame();
    if (this.getAttribute("view") === "result") {
      void this.#support.checkResult().then(() => this.#watchIfPending());
    } else void this.#support.load();
  }

  #watchIfPending() {
    const state = this.#support?.state;
    if (state?.status !== "result" || !state.checking) return;
    this.#watch?.abort();
    this.#watch = new AbortController();
    void this.#support!.watchResult(this.#watch.signal);
  }

  #buildFrame() {
    if (this.#layout === "dialog") {
      this.#dialog = h("dialog", {
        class: "support-dialog",
        part: "dialog",
        "aria-labelledby": "ck-title",
      }) as HTMLDialogElement;
      this.#container.replaceChildren(this.#dialog);
    } else {
      this.#dialog = null;
      this.#container.replaceChildren();
    }
  }

  #mount(card: HTMLElement) {
    (this.#dialog ?? this.#container).replaceChildren(card);
  }

  #update(state: SupportState) {
    this.dispatchEvent(
      new CustomEvent("cheerkit:state", {
        detail: state,
        bubbles: true,
        composed: true,
      }),
    );
    switch (state.status) {
      case "loading":
        return this.#renderOnce("loading", () =>
          this.#card(
            [
              h(
                "p",
                { class: "description", role: "status" },
                this.#text.loading,
              ),
            ],
            {
              busy: true,
            },
          ),
        );
      case "unavailable":
        return this.#renderStatus("unavailable", {
          tone: "danger",
          icon: "alert",
          title: this.#text.unavailableTitle,
          body: this.#errorText(state.error),
          primary: [this.#text.tryAgain, () => void this.#support?.load()],
        });
      case "closed":
        return this.#renderStatus("closed", {
          tone: "muted",
          icon: "pause",
          title: fill(this.#text.closedTitle, { name: this.#name }),
          body: this.#text.closedBody,
        });
      case "ready":
      case "submitting":
        this.#renderOnce("form", () => this.#renderForm(state.context));
        return this.#syncForm(state);
      case "redirecting":
        this.#renderStatus("redirecting", {
          tone: "primary",
          icon: "loader",
          spin: true,
          title: this.#text.redirectingTitle,
          body: fill(this.#text.redirectingBody, {
            amount: this.#form ? this.#chosenLabel() : "",
            name: this.#name,
          }),
        });
        location.assign(state.checkoutUrl);
        return;
      case "no-result":
        return this.#renderStatus("no-result", {
          tone: "muted",
          icon: "alert",
          title: this.#text.noResultTitle,
          body: this.#text.noResultBody,
        });
      case "result":
        return this.#renderResult(
          state.contribution,
          state.checking,
          state.error,
        );
    }
  }

  #renderOnce(key: string, build: () => HTMLElement) {
    if (this.#rendered === key) return;
    this.#rendered = key;
    this.#mount(build());
  }

  #errorText(code: string) {
    const text = this.#text as Record<string, string>;
    return text[`error_${code}`] ?? this.#text.error_default;
  }

  #format(amount: string, currency: string, fractionDigits?: number) {
    return formatMoney(amount, currency, this.#config.locale, fractionDigits);
  }

  #symbol(currency: string) {
    try {
      return (
        new Intl.NumberFormat(this.#config.locale, {
          style: "currency",
          currency,
          currencyDisplay: "narrowSymbol",
        })
          .formatToParts(0)
          .find((part) => part.type === "currency")?.value ?? currency
      );
    } catch {
      return currency;
    }
  }

  #card(
    children: Child[],
    options: { busy?: boolean; className?: string } = {},
  ) {
    const card = h("div", {
      class: `card${options.className ? ` ${options.className}` : ""}`,
      part: "card",
      "aria-busy": options.busy ? "true" : undefined,
    });
    if (this.#layout === "dialog") {
      const close = h(
        "button",
        {
          type: "button",
          class: "close",
          part: "close",
          "aria-label": this.#text.close,
        },
        icon("x", 18),
      );
      close.addEventListener("click", () => this.close());
      const header = children[0];
      if (header instanceof HTMLElement && header.classList.contains("header"))
        header.append(close);
      else card.append(h("div", { class: "header header-end" }, close));
    }
    for (const child of children) if (child) card.append(child);
    return card;
  }

  #header() {
    const avatarUrl = safeImage(this.#config.avatar);
    const initials = this.#name
      .split(/\s+/)
      .map((word) => word[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const avatar = avatarUrl
      ? h("img", {
          class: "avatar",
          part: "avatar",
          src: avatarUrl,
          alt: "",
          referrerpolicy: "no-referrer",
          loading: "lazy",
        })
      : h(
          "span",
          { class: "avatar", part: "avatar", "aria-hidden": "true" },
          initials,
        );
    return h(
      "div",
      { class: "header", part: "header" },
      avatar,
      h(
        "div",
        { class: "who" },
        h("span", { class: "name", part: "name" }, this.#name),
        this.#config.tagline &&
          h(
            "span",
            { class: "tagline", part: "tagline" },
            this.#config.tagline,
          ),
      ),
    );
  }

  #renderForm(context: PublicContext) {
    const text = this.#text;
    const form = h("form", {
      class: "form",
      novalidate: true,
    }) as HTMLFormElement;
    const many = context.currencies.length > 1;
    const amounts = h("div", { class: "amounts", part: "amounts" });
    const range = h("span", { class: "hint", id: "ck-range" });
    const custom = h("input", {
      class: "input",
      part: "input",
      id: "ck-custom",
      name: "custom",
      inputmode: "decimal",
      autocomplete: "off",
      placeholder: text.ownAmountPlaceholder,
      "aria-describedby": "ck-range",
    }) as HTMLInputElement;
    const prefix = h("span", { class: "prefix", "aria-hidden": "true" });
    const notice = h("p", { class: "notice", part: "notice", role: "alert" });
    const button = h("button", {
      type: "submit",
      class: "button",
      part: "button",
    }) as HTMLButtonElement;

    const currencyRules = (): CurrencyRules => {
      const chosen = (
        form.elements.namedItem("currency") as RadioNodeList | null
      )?.value;
      return (
        context.currencies.find((rules) => rules.currency === chosen) ??
        context.currencies[0]!
      );
    };

    const renderAmounts = () => {
      const rules = currencyRules();
      amounts.replaceChildren(
        ...rules.suggestedAmounts.map((amount, index) =>
          h(
            "label",
            { class: "choice" },
            h("input", {
              type: "radio",
              name: "preset",
              value: amount,
              checked: index === Math.min(1, rules.suggestedAmounts.length - 1),
            }),
            h(
              "span",
              { part: "amount" },
              this.#format(amount, rules.currency),
              this.#config.amountNotes?.[index] &&
                h("small", {}, this.#config.amountNotes[index]!),
            ),
          ),
        ),
      );
      amounts.hidden = rules.suggestedAmounts.length === 0;
      prefix.textContent = this.#symbol(rules.currency);
      const minimum = this.#format(rules.minimum, rules.currency);
      range.textContent = rules.maximum
        ? fill(text.range, {
            minimum,
            maximum: this.#format(rules.maximum, rules.currency),
          })
        : fill(text.rangeOpen, { minimum });
      custom.value = "";
      updateButton();
    };

    const updateButton = () => {
      const label = this.#chosenLabel();
      button.textContent = label
        ? fill(text.submit, { amount: label })
        : text.submitNoAmount;
    };

    const currencies = many
      ? h(
          "fieldset",
          { class: "segmented", part: "currency" },
          h("legend", { class: "visually-hidden" }, text.currency),
          ...context.currencies.map((rules, index) =>
            h(
              "label",
              { class: "segment" },
              h("input", {
                type: "radio",
                name: "currency",
                value: rules.currency,
                checked: index === 0,
              }),
              h("span", {}, rules.currency),
            ),
          ),
        )
      : null;

    const field = (
      name: string,
      label: string,
      control: HTMLElement,
      hint: string,
    ) =>
      h(
        "div",
        { class: "field", part: "field" },
        h(
          "label",
          { class: "label", part: "label", for: `ck-${name}` },
          label,
          h("span", { class: "optional" }, text.optional),
        ),
        control,
        h("span", { class: "hint", part: "hint", id: `ck-${name}-hint` }, hint),
      );

    const sections: Child[] = [
      h(
        "fieldset",
        { class: "group" },
        h(
          "div",
          { class: "group-head" },
          h("legend", { class: "label" }, text.chooseAmount),
          currencies,
        ),
        amounts,
        h(
          "div",
          { class: "field", part: "field" },
          h(
            "label",
            { class: "label", part: "label", for: "ck-custom" },
            text.ownAmount,
          ),
          h("div", { class: "prefixed" }, prefix, custom),
          range,
        ),
      ),
      context.collectName &&
        field(
          "name",
          text.supporterName,
          h("input", {
            class: "input",
            part: "input",
            id: "ck-name",
            name: "supporterName",
            autocomplete: "nickname",
            maxlength: "80",
            placeholder: text.supporterNamePlaceholder,
            "aria-describedby": "ck-name-hint",
          }),
          text.supporterNameHint,
        ),
      context.collectMessage &&
        field(
          "message",
          text.message,
          h("textarea", {
            class: "input",
            part: "input",
            id: "ck-message",
            name: "message",
            maxlength: "280",
            rows: "3",
            placeholder: text.messagePlaceholder,
            "aria-describedby": "ck-message-hint",
          }),
          fill(text.messageHint, { name: this.#name }),
        ),
      h(
        "div",
        { class: "submit" },
        notice,
        button,
        h(
          "p",
          { class: "fee-note", part: "fee-note" },
          icon("lock", 14),
          fill(
            context.fees === "owner"
              ? text.feesOwner
              : context.fees === "supporter"
                ? text.feesSupporter
                : text.feesDefault,
            { name: this.#name },
          ),
        ),
      ),
    ];
    for (const section of sections) if (section) form.append(section);
    form.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement;
      if (target.name === "currency") renderAmounts();
      if (target.name === "preset") {
        custom.value = "";
        custom.removeAttribute("aria-invalid");
      }
      updateButton();
    });
    custom.addEventListener("input", () => {
      if (custom.value)
        for (const preset of form.querySelectorAll<HTMLInputElement>(
          'input[name="preset"]',
        ))
          preset.checked = false;
      custom.removeAttribute("aria-invalid");
      notice.textContent = "";
      updateButton();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const rules = currencyRules();
      const typed = custom.value.trim().replace(/,/g, "");
      const preset =
        (form.elements.namedItem("preset") as RadioNodeList | null)?.value ??
        "";
      const amount = typed || preset;
      const problem = !amount
        ? text.errorChooseAmount
        : this.#amountProblem(amount, rules);
      if (problem) {
        notice.textContent = problem;
        if (typed || !amount) {
          custom.setAttribute("aria-invalid", "true");
          custom.focus();
        }
        return;
      }
      notice.textContent = "";
      const valueOf = (name: string) =>
        (
          form.elements.namedItem(name) as HTMLInputElement | null
        )?.value.trim() ?? "";
      const submission: Submission = {
        amount,
        currency: rules.currency,
        ...(valueOf("supporterName")
          ? { supporterName: valueOf("supporterName") }
          : {}),
        ...(valueOf("message") ? { message: valueOf("message") } : {}),
      };
      void this.#support?.submit(submission);
    });

    const intro = h(
      "div",
      { class: "intro" },
      h(
        "h2",
        { class: "title", part: "title", id: "ck-title", tabindex: "-1" },
        this.#config.title ?? fill("Support {name}", { name: this.#name }),
      ),
      this.#config.description &&
        h(
          "p",
          { class: "description", part: "description" },
          this.#config.description,
        ),
    );
    this.#form = form;
    const card = this.#card([this.#header(), intro, form]);
    renderAmounts();
    return card;
  }

  #amountProblem(amount: string, rules: CurrencyRules): string | null {
    const value = scaled(amount, rules.fractionDigits);
    if (value === null) return this.#text.errorAmountFormat;
    const minimum = scaled(rules.minimum, rules.fractionDigits)!;
    const maximum = rules.maximum
      ? scaled(rules.maximum, rules.fractionDigits)
      : null;
    return value < minimum || (maximum !== null && value > maximum)
      ? this.#text.errorAmountRange
      : null;
  }

  #chosenLabel(): string {
    const form = this.#form;
    const state = this.#support?.state;
    if (!form || !state || !("context" in state)) return "";
    const value = (name: string) =>
      (form.elements.namedItem(name) as RadioNodeList | HTMLInputElement | null)
        ?.value ?? "";
    const currency = value("currency") || state.context.currencies[0]?.currency;
    const amount = value("custom").trim().replace(/,/g, "") || value("preset");
    const digits = state.context.currencies.find(
      (rules) => rules.currency === currency,
    )?.fractionDigits;
    return currency && /^\d+(\.\d+)?$/.test(amount)
      ? this.#format(amount, currency, digits)
      : "";
  }

  #syncForm(state: Extract<SupportState, { status: "ready" | "submitting" }>) {
    const form = this.#form;
    if (!form) return;
    const busy = state.status === "submitting";
    form.toggleAttribute("aria-busy", busy);
    for (const element of form.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement
    >("input, textarea, button"))
      element.disabled = busy;
    const notice = form.querySelector(".notice");
    if (notice && state.status === "ready" && state.error)
      notice.textContent = this.#errorText(state.error);
  }

  #renderStatus(
    key: string,
    view: {
      tone: string;
      icon: string;
      spin?: boolean;
      title: string;
      body: string;
      rows?: [string, Node | string][];
      extra?: Child[];
      primary?: [string, () => void];
      secondary?: [string, () => void];
      footnote?: string;
    },
  ) {
    if (this.#rendered === key) return;
    this.#rendered = key;
    this.#form = null;
    const button = (
      className: string,
      [label, action]: [string, () => void],
    ) => {
      const element = h(
        "button",
        { type: "button", class: className, part: className },
        label,
      );
      element.addEventListener("click", action);
      return element;
    };
    const card = this.#card(
      [
        h(
          "div",
          { class: "status-icon", part: "status-icon", "data-tone": view.tone },
          icon(view.icon, 30, view.spin ? "spin" : undefined),
        ),
        h(
          "div",
          { class: "intro" },
          h(
            "h2",
            { class: "title", part: "title", id: "ck-title", tabindex: "-1" },
            view.title,
          ),
          h(
            "p",
            { class: "description", part: "description", role: "status" },
            view.body,
          ),
        ),
        view.rows &&
          h(
            "div",
            { class: "summary", part: "summary" },
            ...view.rows.map(([label, value]) =>
              h("div", {}, h("span", {}, label), value),
            ),
          ),
        ...(view.extra ?? []),
        (view.primary || view.secondary) &&
          h(
            "div",
            { class: "actions" },
            view.primary && button("button", view.primary),
            view.secondary && button("button-secondary", view.secondary),
          ),
        view.footnote && h("p", { class: "footnote" }, view.footnote),
      ],
      { className: "status-view" },
    );
    this.#mount(card);
    card.querySelector<HTMLElement>(".title")?.focus();
  }

  #renderResult(
    contribution: PublicContribution,
    checking: boolean,
    error?: string,
  ) {
    const text = this.#text;
    const amount = this.#format(contribution.amount, contribution.currency);
    const rows = (status: string, tone: string): [string, Node | string][] => [
      [text.amount, h("strong", {}, amount)],
      [text.status, h("span", { class: "dot", "data-tone": tone }, status)],
    ];
    const name = this.#name;
    switch (contribution.outcome) {
      case "confirmed":
        this.#renderStatus(`confirmed:${this.#ownData ? "data" : ""}`, {
          tone: "success",
          icon: "check",
          title: text.confirmedTitle,
          body: fill(text.confirmedBody, { name }),
          rows: rows(text.statusConfirmed, "success"),
          extra: this.#ownDataView(),
        });
        if (!this.#ownData) void this.#loadOwnData();
        break;
      case "refunded":
        this.#renderStatus("refunded", {
          tone: "muted",
          icon: "undo",
          title: text.refundedTitle,
          body: text.refundedBody,
          rows: rows(text.statusRefunded, "warning"),
        });
        break;
      case "unsuccessful":
        this.#renderStatus(`unsuccessful:${error ?? ""}`, {
          tone: "danger",
          icon: "x",
          title: text.unsuccessfulTitle,
          body: error ? this.#errorText(error) : text.unsuccessfulBody,
          rows: rows(text.statusUnsuccessful, "danger"),
          primary: [text.tryAgain, () => void this.#support?.tryAgain()],
        });
        break;
      case "needs_review":
        this.#renderStatus("review", {
          tone: "warning",
          icon: "alert",
          title: text.reviewTitle,
          body: fill(text.reviewBody, { name }),
          rows: rows(text.statusReview, "warning"),
        });
        break;
      case "pending":
        this.#renderStatus(`pending:${checking}:${error ?? ""}`, {
          tone: "warning",
          icon: "hourglass",
          title: checking ? text.checkingTitle : text.waitingTitle,
          body: error
            ? this.#errorText(error)
            : checking
              ? text.checkingBody
              : text.waitingBody,
          rows: rows(text.statusPending, "warning"),
          ...(checking
            ? {}
            : {
                secondary: [
                  text.checkAgain,
                  () =>
                    void this.#support
                      ?.checkResult()
                      .then(() => this.#watchIfPending()),
                ] as [string, () => void],
              }),
        });
        break;
    }
  }

  async #loadOwnData() {
    try {
      this.#ownData = await this.#support!.readOwnData();
      const state = this.#support!.state;
      if (state.status === "result")
        this.#renderResult(state.contribution, state.checking);
    } catch {
      // Without the supporter's own data the thank-you still stands; nothing else depends on it.
    }
  }

  #ownDataView(): Child[] {
    const data = this.#ownData;
    if (!data || (!data.message && !data.supporterName)) return [];
    const text = this.#text;
    const remove = h(
      "button",
      { type: "button", class: "button-secondary", part: "button-secondary" },
      text.removeData,
    );
    const quote =
      data.message &&
      h(
        "div",
        { class: "quote", part: "quote" },
        h("span", {}, text.yourMessage),
        `“${data.message}”`,
      );
    remove.addEventListener("click", async () => {
      remove.setAttribute("disabled", "");
      try {
        this.#ownData = await this.#support!.removeOwnData();
        if (quote) quote.remove();
        remove.replaceWith(
          h("p", { class: "footnote", role: "status" }, text.removedData),
        );
      } catch (error) {
        remove.removeAttribute("disabled");
        remove.after(
          h(
            "p",
            { class: "notice", role: "alert" },
            this.#errorText(
              error instanceof Error ? error.message : "server_error",
            ),
          ),
        );
      }
    });
    return [quote, h("div", { class: "actions" }, remove)];
  }
}

export function defineCheerkitElements() {
  if (!customElements.get("cheerkit-support"))
    customElements.define("cheerkit-support", CheerkitSupportElement);
}
