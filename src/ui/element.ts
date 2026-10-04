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
  back: "Back",
  question: "Support {name}",
  decrease: "One fewer",
  increase: "One more",
  otherAmount: "Enter a different amount",
  countInstead: "Count {unit} instead",
  anyAmount: "Any amount",
  range: "From {minimum} to {maximum}",
  rangeOpen: "From {minimum}",
  continue: "Continue",
  noteHeading: "Say something to {name}",
  noteBody:
    "Optional. {name} sees your name and note; you can remove them later.",
  supporterName: "Your name",
  supporterNamePlaceholder: "Anonymous",
  message: "Note",
  messagePlaceholder: "A few words",
  pay: "Pay {amount}",
  whereItGoes: "Where it goes",
  feesOwner: "Secure checkout by Bachs · fees covered",
  feesSupporter: "Secure checkout by Bachs · fee added at checkout",
  feesDefault: "Secure checkout by Bachs",
  loading: "Loading…",
  openingTitle: "Opening secure checkout",
  openingBody: "{summary} · keep this window open",
  checkingTitle: "Checking with Bachs",
  checkingBody:
    "Usually a few seconds. If you close this, your support still counts once Bachs confirms.",
  waitingTitle: "Still waiting on Bachs",
  waitingBody:
    "It's taking longer than usual. Don't pay again; check back in a little while.",
  checkAgain: "Check again",
  sentUnits: "{count} {unit}, sent",
  sentAmount: "{amount}, sent",
  thanksNote: "{name} will see your note. Thank you.",
  thanksPlain: "Thank you for supporting {name}.",
  done: "Done",
  removeData: "Remove my name and note",
  removedData: "Your name and note were removed.",
  reviewTitle: "{name} is checking this one",
  reviewBody:
    "Something didn't match, so it's with {name} now. Please don't pay again.",
  refundedTitle: "This payment was refunded",
  refundedBody: "The money goes back to how you paid.",
  unsuccessfulTitle: "Payment didn't go through",
  unsuccessfulBody:
    "You weren't charged. Try again, or pick another amount or way to pay.",
  tryAgain: "Try again",
  closedTitle: "{name} is taking a break",
  closedBody: "Support is paused for now. Thanks for thinking of it.",
  unavailableTitle: "Can't reach the server",
  noResultTitle: "Nothing to show here",
  noResultBody: "We couldn't find a payment from this browser tab.",
  owner: "the owner",
  errorChooseAmount: "Enter an amount.",
  errorAmountFormat: "Enter the amount as a number, for example 2500 or 25.50.",
  errorAmountRange: "Choose an amount within the range shown.",
  error_network:
    "Check your connection and try again. You won't be charged twice.",
  error_rate_limited:
    "Too many attempts in a short time. Please wait a minute and try again.",
  error_context_closed: "This isn't accepting support right now.",
  error_amount_out_of_range: "Choose an amount within the range shown.",
  error_invalid_amount:
    "Enter the amount as a number, for example 2500 or 25.50.",
  error_unsupported_currency: "This currency isn't available here.",
  error_invalid_input: "Check the name and note lengths and try again.",
  error_conflict: "This changed while it was being sent. Please try again.",
  error_retry_later: "The server is busy. Please try again shortly.",
  error_default: "Something went wrong on our side. Please try again.",
};

export type SupportText = typeof defaultText;

export const markIcons = [
  "coffee",
  "sprout",
  "heart",
  "book",
  "radio",
  "map",
  "audio",
] as const;

export interface SupportConfig {
  /** Who or what is supported. */
  readonly name?: string;
  /** A person's photo: HTTPS or same-site URL, shown round. */
  readonly avatar?: string;
  /** A product or project logo: HTTPS or same-site URL, shown square. */
  readonly logo?: string;
  /** A built-in square mark when there is no picture. */
  readonly mark?: (typeof markIcons)[number];
  readonly tagline?: string;
  /** The line above the count, such as "Buy Kemi a coffee". */
  readonly question?: string;
  /** One line on where the money goes. */
  readonly where?: string;
  readonly locale?: string;
  readonly text?: Partial<SupportText>;
  readonly appearance?: {
    readonly variables?: Partial<Record<ThemeVariable, string>>;
  };
  /** Extra data stored with the contribution (bounded and validated by the server). */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

type Step = "choose" | "amount" | "note";

function scaled(amount: string, digits: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match || (match[2]?.length ?? 0) > digits) return null;
  return BigInt(match[1]! + (match[2] ?? "").padEnd(digits, "0"));
}

function unscaled(value: bigint, digits: number): string {
  if (digits === 0) return value.toString();
  const text = value.toString().padStart(digits + 1, "0");
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
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
  #rendered = "";
  #ownData: OwnData | null = null;
  #context: PublicContext | null = null;
  #step: Step = "choose";
  #mode: "units" | "typed" = "units";
  #count = 1;
  #typed = "";
  #name = "";
  #message = "";
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

  get #who(): string {
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
    if (variables["color-primary"]) {
      variables["color-primary-light"] ??= variables["color-primary"];
      const readable = readableOn(variables["color-primary"]);
      if (readable) variables["color-on-primary"] ??= readable;
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
    this.#step = "choose";
    this.#mode = "units";
    this.#count = 1;
    this.#context = null;
    this.#typed = "";
    this.#support = createSupport({
      api,
      contextId,
      ...(this.#config.metadata ? { metadata: this.#config.metadata } : {}),
    });
    this.#unsubscribe = this.#support.subscribe((state) => this.#update(state));
    this.#buildFrame();
    if (this.getAttribute("view") === "result") {
      const support = this.#support;
      void support
        .readContext()
        .then((context) => (this.#context = context))
        .catch(() => null)
        .then(() => support.checkResult())
        .then(() => this.#watchIfPending());
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

  #mount(view: HTMLElement, key: string) {
    this.#rendered = key;
    (this.#dialog ?? this.#container).replaceChildren(view);
    view
      .querySelector<HTMLElement>("#ck-title")
      ?.focus({ preventScroll: true });
  }

  #update(state: SupportState) {
    this.dispatchEvent(
      new CustomEvent("cheerkit:state", {
        detail: state,
        bubbles: true,
        composed: true,
      }),
    );
    const text = this.#text;
    switch (state.status) {
      case "loading":
        if (this.#rendered !== "loading")
          this.#mount(
            this.#sheet({
              center: [h("p", { class: "body", role: "status" }, text.loading)],
              busy: true,
            }),
            "loading",
          );
        return;
      case "unavailable":
        return this.#status(`unavailable:${state.error}`, {
          tone: "danger",
          icon: "wifiOff",
          title: text.unavailableTitle,
          body: this.#errorText(state.error),
          primary: [text.tryAgain, () => void this.#support?.load()],
        });
      case "closed":
        return this.#status("closed", {
          tone: "muted",
          icon: "pause",
          title: fill(text.closedTitle, { name: this.#who }),
          body: text.closedBody,
          ...this.#closeAction(),
        });
      case "ready":
      case "submitting":
        return this.#renderStep(state);
      case "redirecting":
        this.#status("redirecting", {
          tone: "primary",
          icon: "loader",
          spin: true,
          title: text.openingTitle,
          body: fill(text.openingBody, { summary: this.#summary() }),
        });
        location.assign(state.checkoutUrl);
        return;
      case "no-result":
        return this.#status("no-result", {
          tone: "muted",
          icon: "alert",
          title: text.noResultTitle,
          body: text.noResultBody,
        });
      case "result":
        return this.#renderResult(
          state.contribution,
          state.checking,
          state.error,
        );
    }
  }

  #errorText(code: string) {
    const text = this.#text as Record<string, string>;
    return text[`error_${code}`] ?? this.#text.error_default;
  }

  #money(amount: string, currency: string, fractionDigits?: number) {
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

  #rules(context: PublicContext): CurrencyRules {
    const wanted = this.getAttribute("currency")?.toUpperCase();
    return (
      context.currencies.find((rules) => rules.currency === wanted) ??
      context.currencies[0]!
    );
  }

  #unit() {
    return this.#context?.unit;
  }

  #unitPrice(rules: CurrencyRules): bigint | null {
    const price = this.#unit() ? rules.unitPrice : undefined;
    if (!price) return null;
    const value = scaled(price, rules.fractionDigits);
    return value && value > 0n ? value : null;
  }

  #unitName(count: number) {
    const unit = this.#unit();
    return unit ? (count === 1 ? unit.one : unit.other) : "";
  }

  #amount(context: PublicContext): string {
    const rules = this.#rules(context);
    const price = this.#unitPrice(rules);
    if (this.#mode === "units" && price)
      return unscaled(price * BigInt(this.#count), rules.fractionDigits);
    return this.#typed.trim().replace(/,/g, "");
  }

  #summary(): string {
    const state = this.#support?.state;
    if (!state || !("context" in state)) return "";
    const rules = this.#rules(state.context);
    const amount = this.#amount(state.context);
    if (!/^\d+(\.\d+)?$/.test(amount)) return "";
    const money = this.#money(amount, rules.currency, rules.fractionDigits);
    return this.#mode === "units" && this.#unitPrice(rules)
      ? `${this.#count} ${this.#unitName(this.#count)} · ${money}`
      : money;
  }

  #withinRules(value: bigint, rules: CurrencyRules) {
    const minimum = scaled(rules.minimum, rules.fractionDigits)!;
    const maximum = rules.maximum
      ? scaled(rules.maximum, rules.fractionDigits)
      : null;
    return value >= minimum && (maximum === null || value <= maximum);
  }

  #closeAction() {
    return this.#dialog
      ? {
          secondary: [this.#text.close, () => this.close()] as [
            string,
            () => void,
          ],
        }
      : {};
  }

  #header() {
    const config = this.#config;
    const picture = safeImage(config.avatar ?? config.logo);
    const square = !config.avatar && Boolean(config.logo || config.mark);
    const initials = this.#who
      .split(/\s+/)
      .map((word) => word[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const mark = picture
      ? h("img", {
          class: `avatar${square ? " square" : ""}`,
          part: "avatar",
          src: picture,
          alt: "",
          referrerpolicy: "no-referrer",
        })
      : config.mark
        ? h(
            "span",
            { class: "avatar mark", part: "avatar", "aria-hidden": "true" },
            icon(config.mark, 19),
          )
        : h(
            "span",
            { class: "avatar", part: "avatar", "aria-hidden": "true" },
            initials,
          );
    return h(
      "div",
      { class: "who", part: "header" },
      mark,
      h(
        "div",
        { class: "who-text" },
        h("span", { class: "name", part: "name" }, this.#who),
        config.tagline &&
          h("span", { class: "tagline", part: "tagline" }, config.tagline),
      ),
    );
  }

  #sheet(view: {
    back?: [string, () => void];
    center: Child[];
    footer?: Child[];
    start?: boolean;
    busy?: boolean;
  }) {
    const left = view.back
      ? (() => {
          const button = h(
            "button",
            { type: "button", class: "back", "aria-label": this.#text.back },
            icon("arrowLeft", 16),
            view.back[0],
          );
          button.addEventListener("click", view.back[1]);
          return button;
        })()
      : this.#header();
    const close = this.#dialog
      ? (() => {
          const button = h(
            "button",
            {
              type: "button",
              class: "close",
              part: "close",
              "aria-label": this.#text.close,
            },
            icon("x", 16),
          );
          button.addEventListener("click", () => this.close());
          return button;
        })()
      : null;
    return h(
      "div",
      {
        class: "sheet",
        part: "card",
        "aria-busy": view.busy ? "true" : undefined,
      },
      h("div", { class: "top" }, left, close),
      h(
        "div",
        { class: `center${view.start ? " start" : ""}`, part: "content" },
        ...view.center,
      ),
      view.footer &&
        h("div", { class: "footer", part: "footer" }, ...view.footer),
    );
  }

  #button(
    kind: "button" | "button-secondary" | "link",
    label: string,
    action: () => void,
  ) {
    const element = h(
      "button",
      { type: "button", class: kind, part: kind },
      label,
    );
    element.addEventListener("click", action);
    return element;
  }

  #secure(context: PublicContext) {
    const text = this.#text;
    return h(
      "p",
      { class: "secure", part: "fee-note" },
      icon("lock", 13),
      context.fees === "owner"
        ? text.feesOwner
        : context.fees === "supporter"
          ? text.feesSupporter
          : text.feesDefault,
    );
  }

  #renderStep(
    state: Extract<SupportState, { status: "ready" | "submitting" }>,
  ) {
    const context = state.context;
    if (this.#context !== context) {
      this.#context = context;
      this.#count = context.unit?.start ?? 1;
    }
    const rules = this.#rules(context);
    if (this.#step === "choose" && !this.#unitPrice(rules)) {
      this.#step = "amount";
      this.#mode = "typed";
    }
    const key = `${this.#step}:${this.#count}:${state.status}:${state.status === "ready" ? (state.error ?? "") : ""}`;
    if (this.#rendered === key) return;
    const view =
      this.#step === "choose"
        ? this.#choose(context, rules)
        : this.#step === "amount"
          ? this.#amountView(context, rules)
          : this.#note(context, rules, state);
    const focusTitle = !this.#rendered.startsWith(`${this.#step}:`);
    this.#rendered = key;
    (this.#dialog ?? this.#container).replaceChildren(view);
    if (focusTitle)
      view
        .querySelector<HTMLElement>("#ck-title")
        ?.focus({ preventScroll: true });
  }

  #go(step: Step) {
    if (step === "choose") this.#mode = "units";
    if (step === "amount") this.#mode = "typed";
    this.#step = step;
    this.#renderCurrent();
  }

  #needsNote(context: PublicContext) {
    return context.collectName || context.collectMessage;
  }

  #proceed(context: PublicContext) {
    if (this.#needsNote(context)) {
      this.#step = "note";
      this.#renderCurrent();
    } else this.#submit(context);
  }

  #renderCurrent() {
    const state = this.#support?.state;
    if (state && (state.status === "ready" || state.status === "submitting"))
      this.#renderStep(state);
  }

  #choose(context: PublicContext, rules: CurrencyRules) {
    const text = this.#text;
    const unit = this.#unit()!;
    const price = this.#unitPrice(rules)!;
    const max = unit.max;
    const fits = (count: number) =>
      count >= 1 &&
      count <= max &&
      this.#withinRules(price * BigInt(count), rules);
    const step = (direction: -1 | 1) => {
      const next = this.#count + direction;
      if (!fits(next)) return;
      this.#count = next;
      this.#renderCurrent();
      const focus = (
        this.#dialog ?? this.#container
      ).querySelector<HTMLElement>(
        direction === 1 ? ".step.plus" : ".step.minus",
      );
      focus?.focus();
    };
    const minus = h(
      "button",
      {
        type: "button",
        class: "step minus",
        part: "step",
        "aria-label": text.decrease,
        disabled: !fits(this.#count - 1),
      },
      icon("minus", 22),
    );
    const plus = h(
      "button",
      {
        type: "button",
        class: "step plus",
        part: "step",
        "aria-label": text.increase,
        disabled: !fits(this.#count + 1),
      },
      icon("plus", 22),
    );
    minus.addEventListener("click", () => step(-1));
    plus.addEventListener("click", () => step(1));
    const total = unscaled(price * BigInt(this.#count), rules.fractionDigits);
    const unitIcon = unit.icon;
    const units = h(
      "div",
      { class: "units", part: "units", "aria-hidden": "true" },
      ...Array.from({ length: 5 }, (_, index) => {
        const svg = icon(unitIcon, 20);
        if (index >= this.#count) svg.setAttribute("data-off", "");
        return svg;
      }),
    );
    return this.#sheet({
      center: [
        h(
          "h2",
          {
            class: "question",
            part: "question",
            id: "ck-title",
            tabindex: "-1",
          },
          this.#config.question ?? fill(text.question, { name: this.#who }),
        ),
        h(
          "div",
          { class: "stepper", part: "stepper" },
          minus,
          h(
            "div",
            { class: "count", role: "status", "aria-live": "polite" },
            h("span", { class: "count-number" }, String(this.#count)),
            h("span", { class: "count-unit" }, this.#unitName(this.#count)),
          ),
          plus,
        ),
        units,
        h(
          "p",
          { class: "total", part: "total" },
          this.#money(total, rules.currency, rules.fractionDigits),
        ),
        this.#config.where &&
          h(
            "div",
            { class: "where", part: "where" },
            h("span", { class: "where-label" }, text.whereItGoes),
            h("p", { class: "where-text" }, this.#config.where),
          ),
      ],
      footer: [
        this.#button("button", text.continue, () => this.#proceed(context)),
        this.#button("link", text.otherAmount, () => this.#go("amount")),
      ],
    });
  }

  #amountView(context: PublicContext, rules: CurrencyRules) {
    const text = this.#text;
    const notice = h("p", { class: "notice", role: "alert" });
    const input = h("input", {
      class: "typed-input",
      part: "input",
      id: "ck-amount",
      inputmode: "decimal",
      autocomplete: "off",
      placeholder: "0",
      "aria-label": text.anyAmount,
      "aria-describedby": "ck-range",
      value: this.#typed,
    }) as HTMLInputElement;
    const fit = () => {
      input.size = Math.max(1, input.value.length || 1);
    };
    fit();
    input.addEventListener("input", () => {
      fit();
      this.#typed = input.value;
      input.removeAttribute("aria-invalid");
      notice.textContent = "";
    });
    const minimum = this.#money(rules.minimum, rules.currency);
    const range = rules.maximum
      ? fill(text.range, {
          minimum,
          maximum: this.#money(rules.maximum, rules.currency),
        })
      : fill(text.rangeOpen, { minimum });
    const proceed = () => {
      const amount = this.#amount(context);
      const value = scaled(amount, rules.fractionDigits);
      const problem = !amount
        ? text.errorChooseAmount
        : value === null
          ? text.errorAmountFormat
          : this.#withinRules(value, rules)
            ? null
            : text.errorAmountRange;
      if (problem) {
        notice.textContent = problem;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      this.#proceed(context);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") proceed();
    });
    const unit = this.#unit();
    return this.#sheet({
      center: [
        h(
          "h2",
          { class: "question", id: "ck-title", tabindex: "-1" },
          text.anyAmount,
        ),
        h(
          "label",
          { class: "typed", for: "ck-amount" },
          h(
            "span",
            { class: "typed-symbol", "aria-hidden": "true" },
            this.#symbol(rules.currency),
          ),
          input,
        ),
        h("p", { class: "hint", id: "ck-range" }, range),
        unit &&
          this.#unitPrice(rules) !== null &&
          (() => {
            const chip = h(
              "button",
              { type: "button", class: "chip" },
              icon(unit.icon, 15),
              fill(text.countInstead, { unit: unit.other }),
            );
            chip.addEventListener("click", () => this.#go("choose"));
            return chip;
          })(),
        notice,
      ],
      footer: [this.#button("button", text.continue, proceed)],
    });
  }

  #note(
    context: PublicContext,
    rules: CurrencyRules,
    state: Extract<SupportState, { status: "ready" | "submitting" }>,
  ) {
    const text = this.#text;
    const busy = state.status === "submitting";
    const name = context.collectName
      ? (h("input", {
          class: "input",
          part: "input",
          id: "ck-name",
          autocomplete: "nickname",
          maxlength: "80",
          placeholder: text.supporterNamePlaceholder,
          value: this.#name,
          disabled: busy,
        }) as HTMLInputElement)
      : null;
    const message = context.collectMessage
      ? (h("textarea", {
          class: "input",
          part: "input",
          id: "ck-message",
          maxlength: "280",
          rows: "4",
          placeholder: text.messagePlaceholder,
          disabled: busy,
        }) as HTMLTextAreaElement)
      : null;
    if (message) message.value = this.#message;
    name?.addEventListener("input", () => (this.#name = name.value));
    message?.addEventListener("input", () => (this.#message = message.value));
    const pay = this.#button(
      "button",
      fill(text.pay, {
        amount: this.#money(
          this.#amount(context),
          rules.currency,
          rules.fractionDigits,
        ),
      }),
      () => this.#submit(context),
    ) as HTMLButtonElement;
    pay.disabled = busy;
    return this.#sheet({
      back: [
        this.#summary(),
        () => this.#go(this.#mode === "typed" ? "amount" : "choose"),
      ],
      start: true,
      busy,
      center: [
        h(
          "h2",
          { class: "heading", id: "ck-title", tabindex: "-1" },
          fill(text.noteHeading, { name: this.#who }),
        ),
        h("p", { class: "body" }, fill(text.noteBody, { name: this.#who })),
        name &&
          h(
            "div",
            { class: "field", part: "field" },
            h("label", { class: "label", for: "ck-name" }, text.supporterName),
            name,
          ),
        message &&
          h(
            "div",
            { class: "field", part: "field" },
            h("label", { class: "label", for: "ck-message" }, text.message),
            message,
          ),
      ],
      footer: [
        h(
          "p",
          { class: "notice", role: "alert" },
          state.status === "ready" && state.error
            ? this.#errorText(state.error)
            : "",
        ),
        pay,
        this.#secure(context),
      ],
    });
  }

  #submit(context: PublicContext) {
    const rules = this.#rules(context);
    const submission: Submission = {
      amount: this.#amount(context),
      currency: rules.currency,
      ...(context.collectName && this.#name.trim()
        ? { supporterName: this.#name.trim() }
        : {}),
      ...(context.collectMessage && this.#message.trim()
        ? { message: this.#message.trim() }
        : {}),
    };
    void this.#support?.submit(submission);
  }

  #status(
    key: string,
    view: {
      tone: string;
      icon: string;
      spin?: boolean;
      title: string;
      body: string;
      extra?: Child[];
      art?: Child;
      primary?: [string, () => void];
      secondary?: [string, () => void];
      link?: [string, () => void];
    },
  ) {
    if (this.#rendered === key) return;
    this.#mount(
      this.#sheet({
        center: [
          view.art ??
            h(
              "div",
              {
                class: "status-icon",
                part: "status-icon",
                "data-tone": view.tone,
              },
              icon(view.icon, 30, view.spin ? "spin" : undefined),
            ),
          h(
            "h2",
            { class: "title", part: "title", id: "ck-title", tabindex: "-1" },
            view.title,
          ),
          h(
            "p",
            { class: "body", part: "description", role: "status" },
            view.body,
          ),
          ...(view.extra ?? []),
        ],
        footer: [
          view.primary && this.#button("button", ...view.primary),
          view.secondary && this.#button("button-secondary", ...view.secondary),
          view.link && this.#button("link", ...view.link),
        ],
      }),
      key,
    );
  }

  #renderResult(
    contribution: PublicContribution,
    checking: boolean,
    error?: string,
  ) {
    const text = this.#text;
    const name = this.#who;
    switch (contribution.outcome) {
      case "confirmed": {
        const unit = this.#unit();
        const price = unit
          ? this.#context?.currencies.find(
              (rules) => rules.currency === contribution.currency,
            )?.unitPrice
          : undefined;
        const digits = contribution.amount.split(".")[1]?.length ?? 0;
        const paid = scaled(contribution.amount, digits);
        const each = price ? scaled(price, digits) : null;
        const count =
          paid !== null && each && each > 0n && paid % each === 0n
            ? Number(paid / each)
            : null;
        const data = this.#ownData;
        const art =
          count && unit
            ? h(
                "div",
                { class: "done-units", "aria-hidden": "true" },
                ...Array.from({ length: Math.min(count, 5) }, () =>
                  h("span", {}, icon(unit.icon, 22)),
                ),
              )
            : undefined;
        this.#status(
          `confirmed:${data ? (data.message ? "note" : "plain") : ""}`,
          {
            tone: "success",
            icon: "check",
            ...(art ? { art } : {}),
            title:
              count && unit
                ? fill(text.sentUnits, {
                    count: String(count),
                    unit: count === 1 ? unit.one : unit.other,
                  })
                : fill(text.sentAmount, {
                    amount: this.#money(
                      contribution.amount,
                      contribution.currency,
                    ),
                  }),
            body: fill(data?.message ? text.thanksNote : text.thanksPlain, {
              name,
            }),
            ...(this.#dialog
              ? {
                  secondary: [text.done, () => this.close()] as [
                    string,
                    () => void,
                  ],
                }
              : {}),
            ...(data && (data.message || data.supporterName)
              ? {
                  link: [text.removeData, () => void this.#removeOwnData()] as [
                    string,
                    () => void,
                  ],
                }
              : {}),
          },
        );
        if (!data) void this.#loadOwnData();
        return;
      }
      case "refunded":
        return this.#status("refunded", {
          tone: "muted",
          icon: "undo",
          title: text.refundedTitle,
          body: text.refundedBody,
        });
      case "unsuccessful":
        return this.#status(`unsuccessful:${error ?? ""}`, {
          tone: "danger",
          icon: "x",
          title: text.unsuccessfulTitle,
          body: error ? this.#errorText(error) : text.unsuccessfulBody,
          primary: [text.tryAgain, () => void this.#support?.tryAgain()],
        });
      case "needs_review":
        return this.#status("review", {
          tone: "warning",
          icon: "shieldCheck",
          title: fill(text.reviewTitle, { name }),
          body: fill(text.reviewBody, { name }),
          ...this.#closeAction(),
        });
      case "pending":
        return checking
          ? this.#status(`checking:${error ?? ""}`, {
              tone: "warning",
              icon: "hourglass",
              title: text.checkingTitle,
              body: error ? this.#errorText(error) : text.checkingBody,
              extra: [
                h(
                  "div",
                  { class: "dots", "aria-hidden": "true" },
                  h("span"),
                  h("span"),
                  h("span"),
                ),
              ],
            })
          : this.#status(`waiting:${error ?? ""}`, {
              tone: "warning",
              icon: "timer",
              title: text.waitingTitle,
              body: error ? this.#errorText(error) : text.waitingBody,
              secondary: [
                text.checkAgain,
                () =>
                  void this.#support
                    ?.checkResult()
                    .then(() => this.#watchIfPending()),
              ],
            });
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

  async #removeOwnData() {
    const root = this.#dialog ?? this.#container;
    const link = root.querySelector<HTMLButtonElement>(".footer .link");
    link?.setAttribute("disabled", "");
    try {
      this.#ownData = await this.#support!.removeOwnData();
      link?.replaceWith(
        h("p", { class: "hint", role: "status" }, this.#text.removedData),
      );
    } catch (error) {
      link?.removeAttribute("disabled");
      link?.after(
        h(
          "p",
          { class: "notice", role: "alert" },
          this.#errorText(
            error instanceof Error ? error.message : "server_error",
          ),
        ),
      );
    }
  }
}

export function defineCheerkitElements() {
  if (!customElements.get("cheerkit-support"))
    customElements.define("cheerkit-support", CheerkitSupportElement);
}
