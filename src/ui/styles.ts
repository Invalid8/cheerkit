/** The public theme variables, settable from the host page's CSS or `appearance.variables`. */
export const themeVariables = [
  "color-background",
  "color-surface",
  "color-text",
  "color-text-muted",
  "color-border",
  "color-primary",
  "color-on-primary",
  "color-danger",
  "color-success",
  "color-warning",
  "font-family",
  "font-size-base",
  "radius",
  "radius-control",
  "border-width",
] as const;

export type ThemeVariable = (typeof themeVariables)[number];

const light = `
  --ck-color-background: #f3f0e8;
  --ck-color-surface: #fbfaf6;
  --ck-color-text: #1f1e1b;
  --ck-color-text-muted: #5f5b52;
  --ck-color-border: #ddd7ca;
  --ck-color-primary: #1c2b4a;
  --ck-color-on-primary: #ffffff;
  --ck-color-danger: #b42318;
  --ck-color-success: #1e6b45;
  --ck-color-warning: #8a5a00;`;

const dark = `
  --ck-color-background: #161616;
  --ck-color-surface: #1f1f1f;
  --ck-color-text: #f2f0ea;
  --ck-color-text-muted: #a8a49a;
  --ck-color-border: #363431;
  --ck-color-primary: #3d5d9e;
  --ck-color-on-primary: #ffffff;
  --ck-color-danger: #f97066;
  --ck-color-success: #6cc08b;
  --ck-color-warning: #e0b04b;`;

export const supportStyles = `
:host {
  ${light}
  --ck-font-family: inherit;
  --ck-font-size-base: 16px;
  --ck-radius: 14px;
  --ck-radius-control: 10px;
  --ck-border-width: 1px;
  display: block;
  color: var(--ck-color-text);
  font-family: var(--ck-font-family);
  font-size: var(--ck-font-size-base);
  line-height: 1.45;
  color-scheme: light;
}
:host([theme="dark"]) { ${dark} color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  :host([theme="system"]) { ${dark} color-scheme: dark; }
}
:host([hidden]) { display: none; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
p { margin: 0; }
.form { display: grid; gap: 22px; }
.header-end { justify-content: flex-end; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

.card {
  display: grid;
  gap: 22px;
  width: 100%;
  max-width: 480px;
  margin-inline: auto;
  padding: 28px;
  background: var(--ck-color-surface);
  border: var(--ck-border-width) solid var(--ck-color-border);
  border-radius: var(--ck-radius);
}

.support-dialog {
  width: min(440px, 100vw - 32px);
  max-height: calc(100dvh - 32px);
  padding: 0;
  border: 0;
  border-radius: var(--ck-radius);
  background: transparent;
  color: inherit;
  overflow: auto;
}
dialog::backdrop { background: rgb(11 11 12 / 0.55); }
.support-dialog .card { box-shadow: 0 24px 60px rgb(0 0 0 / 0.25); }
@media (max-width: 480px) {
  .support-dialog {
    width: 100vw;
    max-width: 100vw;
    max-height: 100dvh;
    height: 100dvh;
    margin: 0;
    border-radius: 0;
  }
  .support-dialog .card { min-height: 100%; border: 0; border-radius: 0; box-shadow: none; padding: 20px; }
}

.header { display: flex; align-items: center; gap: 14px; }
.avatar {
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--ck-color-background);
  display: grid;
  place-items: center;
  font-weight: 600;
  color: var(--ck-color-text-muted);
}
.who { display: grid; gap: 2px; min-width: 0; flex: 1; }
.name { font-size: 1.0625em; font-weight: 600; }
.tagline { font-size: 0.875em; color: var(--ck-color-text-muted); }

.intro { display: grid; gap: 6px; }
.title { margin: 0; font-size: 1.625em; line-height: 1.15; letter-spacing: -0.015em; font-weight: 700; }
.title:focus-visible { outline: 2px solid var(--ck-color-primary); outline-offset: 3px; border-radius: 2px; }
.description { margin: 0; font-size: 0.9375em; color: var(--ck-color-text-muted); }

.group { display: grid; gap: 14px; border: 0; margin: 0; padding: 0; min-width: 0; }
.group-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.label, legend { font-size: 0.875em; font-weight: 500; padding: 0; }
.optional { font-weight: 400; color: var(--ck-color-text-muted); margin-inline-start: 6px; }
.hint { font-size: 0.8125em; color: var(--ck-color-text-muted); }

.amounts { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 10px; }
.choice { position: relative; display: grid; }
.choice input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.choice span {
  display: grid;
  place-items: center;
  gap: 2px;
  min-height: 48px;
  padding: 12px;
  text-align: center;
  font-weight: 600;
  font-size: 1.0625em;
  background: var(--ck-color-surface);
  border: var(--ck-border-width) solid var(--ck-color-border);
  border-radius: var(--ck-radius-control);
}
.choice small { font-size: 0.765em; font-weight: 400; color: var(--ck-color-text-muted); }
.choice input:checked + span { background: var(--ck-color-primary); border-color: var(--ck-color-primary); color: var(--ck-color-on-primary); }
.choice input:checked + span small { color: inherit; opacity: 0.8; }
.choice input:focus-visible + span, .segment input:focus-visible + span { outline: 2px solid var(--ck-color-primary); outline-offset: 2px; }

.segmented { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--ck-radius-control); background: var(--ck-color-background); border: 0; margin: 0; }
.segment { position: relative; display: grid; }
.segment input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.segment span { padding: 5px 12px; font-size: 0.8125em; font-weight: 500; color: var(--ck-color-text-muted); border-radius: calc(var(--ck-radius-control) - 3px); }
.segment input:checked + span { background: var(--ck-color-primary); color: var(--ck-color-on-primary); font-weight: 600; }

.field { display: grid; gap: 6px; }
.input {
  width: 100%;
  min-height: 48px;
  padding: 12px 14px;
  font: inherit;
  font-size: max(16px, 1em);
  color: var(--ck-color-text);
  background: var(--ck-color-surface);
  border: var(--ck-border-width) solid var(--ck-color-border);
  border-radius: var(--ck-radius-control);
}
textarea.input { min-height: 88px; resize: vertical; }
.input::placeholder { color: var(--ck-color-text-muted); }
.input:focus-visible { outline: 2px solid var(--ck-color-primary); outline-offset: 1px; border-color: var(--ck-color-primary); }
.input[aria-invalid="true"] { border-color: var(--ck-color-danger); }
.prefixed { position: relative; }
.prefixed .prefix { position: absolute; inset-block: 0; inset-inline-start: 14px; display: grid; place-items: center; color: var(--ck-color-text-muted); pointer-events: none; }
.prefixed .input { padding-inline-start: 36px; }

.submit { display: grid; gap: 12px; }
.button, .button-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 13px 20px;
  font: inherit;
  font-weight: 600;
  border-radius: var(--ck-radius-control);
  cursor: pointer;
}
.button {
  color: var(--ck-color-on-primary);
  background: var(--ck-color-primary);
  border: 0;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.18), 0 1px 2px rgb(0 0 0 / 0.12);
}
.button-secondary {
  color: var(--ck-color-text);
  background: var(--ck-color-surface);
  border: var(--ck-border-width) solid var(--ck-color-border);
  font-weight: 500;
}
.button:focus-visible, .button-secondary:focus-visible, .close:focus-visible, .link:focus-visible { outline: 2px solid var(--ck-color-primary); outline-offset: 2px; }
.button:disabled { opacity: 0.7; cursor: progress; }
.fee-note { display: flex; justify-content: center; align-items: center; gap: 8px; text-wrap: balance; font-size: 0.8125em; color: var(--ck-color-text-muted); text-align: center; }
.notice:empty { display: none; }
.notice { margin: 0; font-size: 0.875em; color: var(--ck-color-danger); }

.close {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--ck-radius-control);
  background: var(--ck-color-background);
  color: var(--ck-color-text-muted);
  cursor: pointer;
}

.status-view { text-align: center; justify-items: center; padding-top: 36px; }
.status-icon { width: 64px; height: 64px; display: grid; place-items: center; border-radius: var(--ck-radius-control); background: var(--ck-color-background); }
.status-icon[data-tone="success"] { color: var(--ck-color-success); }
.status-icon[data-tone="warning"] { color: var(--ck-color-warning); }
.status-icon[data-tone="danger"] { color: var(--ck-color-danger); }
.status-icon[data-tone="muted"] { color: var(--ck-color-text-muted); }
.status-icon[data-tone="primary"] { color: var(--ck-color-primary); }
.summary { width: 100%; display: grid; padding: 4px 16px; border-radius: var(--ck-radius-control); background: var(--ck-color-background); text-align: start; }
.summary div { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; font-size: 0.875em; color: var(--ck-color-text-muted); }
.summary div + div { border-top: var(--ck-border-width) solid var(--ck-color-border); }
.summary strong { color: var(--ck-color-text); font-size: 1.07em; }
.dot { display: inline-flex; align-items: center; gap: 6px; color: var(--ck-color-text); font-weight: 500; }
.dot::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.dot[data-tone="success"]::before { background: var(--ck-color-success); }
.dot[data-tone="warning"]::before { background: var(--ck-color-warning); }
.dot[data-tone="danger"]::before { background: var(--ck-color-danger); }
.quote { width: 100%; display: grid; gap: 6px; padding: 14px 16px; text-align: start; border: var(--ck-border-width) solid var(--ck-color-border); border-radius: var(--ck-radius-control); }
.quote span { font-size: 0.8125em; color: var(--ck-color-text-muted); }
.actions { width: 100%; display: grid; gap: 10px; }
.footnote { font-size: 0.75em; color: var(--ck-color-text-muted); }
.spin { animation: ck-spin 1s linear infinite; }
@keyframes ck-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
svg { display: block; }
@supports (color: contrast-color(red)) {
  :host { --ck-color-on-primary: contrast-color(var(--ck-color-primary)); }
}
`;
