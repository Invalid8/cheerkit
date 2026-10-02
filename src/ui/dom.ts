export type Attributes = Record<string, string | boolean | undefined>;
export type Child = Node | string | null | undefined | false;

export function h(
  tag: string,
  attributes: Attributes = {},
  ...children: Child[]
) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children)
    if (child !== null && child !== undefined && child !== false)
      element.append(child);
  return element;
}

const icons: Record<string, string[]> = {
  receipt: [
    "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z",
    "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",
    "M12 17.5v-11",
  ],
  inbox: [
    "M22 12h-6l-2 3h-4l-2-3H2",
    "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  ],
  sliders: [
    "M21 4h-7",
    "M10 4H3",
    "M21 12h-9",
    "M8 12H3",
    "M21 20h-5",
    "M12 20H3",
    "M14 2v4",
    "M8 10v4",
    "M16 18v4",
  ],
  zap: [
    "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  ],
  download: [
    "M12 15V3",
    "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
    "m7 10 5 5 5-5",
  ],
  user: [
    "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",
    "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  ],
  shield: [
    "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  ],
  info: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M12 16v-4", "M12 8h.01"],
  refresh: [
    "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
    "M21 3v5h-5",
    "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
    "M8 16H3v5",
  ],
  send: [
    "M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z",
    "m21.85 2.15-10.94 10.94",
  ],
  merge: ["m16 3 4 4-4 4", "M20 7H4", "m8 21-4-4 4-4", "M4 17h16"],
  wifiOff: [
    "M12 20h.01",
    "M8.5 16.43a5 5 0 0 1 7 0",
    "M5 12.86a10 10 0 0 1 5.17-2.69",
    "M19 12.86a10 10 0 0 0-2-1.39",
    "M2 8.82a15 15 0 0 1 4.18-2.65",
    "M22 8.82a15 15 0 0 0-11.29-3.76",
    "m2 2 20 20",
  ],
  x: ["M18 6 6 18", "m6 6 12 12"],
  lock: [
    "M7 11V7a5 5 0 0 1 10 0v4",
    "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z",
  ],
  check: ["M20 6 9 17l-5-5"],
  loader: ["M21 12a9 9 0 1 1-6.219-8.56"],
  hourglass: [
    "M5 22h14",
    "M5 2h14",
    "M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22",
    "M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2",
  ],
  pause: ["M14 4h4v16h-4z", "M6 4h4v16H6z"],
  alert: [
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    "M12 9v4",
    "M12 17h.01",
  ],
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
};

export function icon(name: string, size: number, className?: string) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, value);
  if (className) svg.setAttribute("class", className);
  for (const d of icons[name] ?? []) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key]! : match,
  );
}

export function safeImage(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    return url.protocol === "https:" || url.origin === location.origin
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Formats an amount string exactly: whole amounts without decimals, others with at least the currency's digits. */
export function formatMoney(
  amount: string,
  currency: string,
  locale?: string,
  fractionDigits?: number,
): string {
  const fraction = amount.split(".")[1] ?? "";
  const digits = /^0*$/.test(fraction)
    ? 0
    : Math.max(fraction.length, fractionDigits ?? 0);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}
