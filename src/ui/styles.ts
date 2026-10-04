/** The public theme variables, settable from the host page's CSS or `appearance.variables`. */
export const themeVariables = [
  "color-background",
  "color-surface",
  "color-field",
  "color-text",
  "color-text-muted",
  "color-border",
  "color-primary",
  "color-primary-light",
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
  --ck-color-background: #e9e5de;
  --ck-color-surface: #fbfaf7;
  --ck-color-field: #f1ede6;
  --ck-color-text: #121110;
  --ck-color-text-muted: #6e6860;
  --ck-color-border: #ddd7cd;
  --ck-color-primary: #5b1a22;
  --ck-color-primary-light: #7a2a33;
  --ck-color-on-primary: #fbf4f0;
  --ck-color-danger: #b42318;
  --ck-color-success: #1e6b45;
  --ck-color-warning: #8a5a00;
  --ck-font-family: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif;
  --ck-shadow: 0 20px 50px rgb(18 17 16 / 0.1);`;

const dark = `
  --ck-color-background: #0b0b0c;
  --ck-color-surface: #141416;
  --ck-color-field: #1c1c1f;
  --ck-color-text: #f4f1ea;
  --ck-color-text-muted: #9c978d;
  --ck-color-border: #2a2a2e;
  --ck-color-primary: #c8ae78;
  --ck-color-primary-light: #e0c995;
  --ck-color-on-primary: #17140d;
  --ck-color-danger: #f97066;
  --ck-color-success: #6cc08b;
  --ck-color-warning: #e0b04b;
  --ck-font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
  --ck-shadow: 0 24px 60px rgb(0 0 0 / 0.5);`;

export const supportStyles = `
:host {
  ${light}
  --ck-font-size-base: 16px;
  --ck-radius: 22px;
  --ck-radius-control: 14px;
  --ck-border-width: 1px;
  display: block;
  color: var(--ck-color-text);
  font-family: var(--ck-font-family);
  font-size: var(--ck-font-size-base);
  line-height: 1.45;
  color-scheme: light;
  -webkit-font-smoothing: antialiased;
}
:host([theme="dark"]) { ${dark} color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  :host([theme="system"]) { ${dark} color-scheme: dark; }
}
:host([hidden]) { display: none; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
p { margin: 0; }
button { font: inherit; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

.sheet {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  max-width: 400px;
  min-height: 600px;
  margin-inline: auto;
  padding: 24px 28px 28px;
  background: var(--ck-color-surface);
  border: var(--ck-border-width) solid var(--ck-color-border);
  border-radius: var(--ck-radius);
  box-shadow: var(--ck-shadow);
}
.support-dialog {
  width: min(400px, 100vw - 32px);
  max-height: calc(100dvh - 32px);
  padding: 0;
  border: 0;
  border-radius: var(--ck-radius);
  background: transparent;
  color: inherit;
  overflow: auto;
}
dialog::backdrop { background: rgb(18 17 16 / 0.45); backdrop-filter: blur(6px); }
@media (max-width: 480px) {
  .support-dialog {
    width: 100vw;
    max-width: 100vw;
    max-height: 92dvh;
    margin: auto 0 0;
    border-radius: 28px 28px 0 0;
  }
  .support-dialog .sheet { min-height: 0; border: 0; border-radius: 28px 28px 0 0; box-shadow: none; padding: 32px 24px 28px; }
  .support-dialog .sheet::before { content: ""; position: absolute; top: 10px; left: 50%; width: 40px; height: 4px; margin-left: -20px; border-radius: 2px; background: var(--ck-color-border); }
  .support-dialog .sheet { position: relative; }
}

.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; }
.who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.who-text { display: grid; min-width: 0; }
.avatar { flex: none; width: 36px; height: 36px; border-radius: 50%; object-fit: cover; background: var(--ck-color-field); display: grid; place-items: center; font-size: 13px; font-weight: 700; color: var(--ck-color-text-muted); }
.avatar.square { border-radius: 10px; }
.avatar.mark { border-radius: 10px; background: var(--ck-color-primary); color: var(--ck-color-on-primary); }
.name { font-size: 15px; font-weight: 700; line-height: 1.3; }
.tagline { font-size: 13px; color: var(--ck-color-text-muted); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.back { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0; border: 0; background: none; color: var(--ck-color-text); font-size: 15px; font-weight: 600; cursor: pointer; }
.close {
  flex: none;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: var(--ck-color-field);
  color: var(--ck-color-text-muted);
  cursor: pointer;
}

.center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px 0; text-align: center; }
.center.start { justify-content: flex-start; align-items: stretch; text-align: start; padding-top: 28px; }
.question { font-size: 15px; font-weight: 500; color: var(--ck-color-text-muted); }
.stepper { display: flex; align-items: center; gap: 28px; }
.step {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: var(--ck-radius-control);
  border: var(--ck-border-width) solid var(--ck-color-border);
  background: var(--ck-color-surface);
  color: var(--ck-color-text);
  cursor: pointer;
}
.step.plus { background: var(--ck-color-primary); border-color: var(--ck-color-primary); color: var(--ck-color-on-primary); }
.step:disabled { opacity: 0.35; cursor: default; }
.count { display: grid; justify-items: center; width: 120px; }
.count-number { font-size: 108px; font-weight: 700; letter-spacing: -0.05em; line-height: 1; font-variant-numeric: tabular-nums; }
.count-unit { font-size: 15px; font-weight: 500; color: var(--ck-color-text-muted); }
.units { display: flex; gap: 8px; color: var(--ck-color-text); }
.units svg[data-off] { opacity: 0.2; }
.total { font-size: 20px; font-weight: 700; }
.where { display: grid; gap: 8px; width: 280px; padding-top: 16px; border-top: var(--ck-border-width) solid var(--ck-color-border); }
.where-label { font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ck-color-text-muted); }
.where-text { font-size: 15px; font-weight: 500; line-height: 1.4; }
.typed { display: flex; align-items: center; justify-content: center; gap: 4px; max-width: 100%; }
.typed-symbol { font-size: 44px; font-weight: 500; color: var(--ck-color-text-muted); }
.typed-input { width: auto; min-width: 1ch; max-width: 100%; padding: 0; border: 0; background: none; color: var(--ck-color-text); font: inherit; font-size: 72px; font-weight: 700; letter-spacing: -0.035em; line-height: 1; caret-color: var(--ck-color-primary); field-sizing: content; }
.typed-input:focus { outline: none; }
.typed-input::placeholder { color: var(--ck-color-border); }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 10px; border: var(--ck-border-width) solid var(--ck-color-border); background: var(--ck-color-surface); color: var(--ck-color-text); font-size: 14px; font-weight: 500; cursor: pointer; }
.heading { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.017em; line-height: 1.2; }
.title { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; }
[tabindex="-1"]:focus { outline: none; }
.body { font-size: 15px; color: var(--ck-color-text-muted); line-height: 1.5; max-width: 300px; }
.center.start .body { max-width: none; font-size: 14px; }

.field { display: grid; gap: 6px; width: 100%; text-align: start; }
.label { font-size: 13px; font-weight: 500; color: var(--ck-color-text-muted); }
.optional { font-weight: 400; color: var(--ck-color-text-muted); margin-inline-start: 6px; }
.hint { font-size: 12px; color: var(--ck-color-text-muted); }
.input {
  width: 100%;
  min-height: 52px;
  padding: 14px 16px;
  font: inherit;
  font-size: max(16px, 1em);
  color: var(--ck-color-text);
  background: var(--ck-color-field);
  border: var(--ck-border-width) solid transparent;
  border-radius: var(--ck-radius-control);
}
textarea.input { min-height: 120px; resize: vertical; line-height: 1.45; }
.input::placeholder { color: var(--ck-color-text-muted); }
.input:focus-visible { outline: none; border-color: var(--ck-color-primary); }
.input[aria-invalid="true"] { border-color: var(--ck-color-danger); }

.footer { display: grid; gap: 12px; justify-items: center; }
.button, .button-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 52px;
  padding: 13px 20px;
  font-weight: 700;
  border-radius: var(--ck-radius-control);
  cursor: pointer;
}
.button {
  color: var(--ck-color-on-primary);
  background: linear-gradient(180deg, var(--ck-color-primary-light), var(--ck-color-primary));
  border: 0;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), 0 8px 20px rgb(0 0 0 / 0.13);
}
.button-secondary {
  min-height: 50px;
  color: var(--ck-color-text);
  background: var(--ck-color-surface);
  border: var(--ck-border-width) solid var(--ck-color-border);
  font-weight: 600;
}
.button:disabled { opacity: 0.6; cursor: progress; }
.link { padding: 2px 0; border: 0; background: none; color: var(--ck-color-text-muted); font-size: 14px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.secure { display: flex; justify-content: center; align-items: center; gap: 6px; font-size: 13px; color: var(--ck-color-text-muted); text-align: center; text-wrap: balance; }
.notice:empty { display: none; }
.notice { margin: 0; font-size: 14px; color: var(--ck-color-danger); text-align: center; }
.button:focus-visible, .button-secondary:focus-visible, .close:focus-visible, .link:focus-visible, .step:focus-visible, .chip:focus-visible, .back:focus-visible { outline: 2px solid var(--ck-color-primary); outline-offset: 2px; }

.status-icon { width: 72px; height: 72px; display: grid; place-items: center; border-radius: 22px; background: var(--ck-color-field); }
.status-icon[data-tone="success"] { color: var(--ck-color-success); }
.status-icon[data-tone="warning"] { color: var(--ck-color-warning); }
.status-icon[data-tone="danger"] { color: var(--ck-color-danger); }
.status-icon[data-tone="muted"] { color: var(--ck-color-text-muted); }
.status-icon[data-tone="primary"] { color: var(--ck-color-primary); }
.done-units { display: flex; gap: 6px; }
.done-units span { width: 56px; height: 56px; display: grid; place-items: center; border-radius: 50%; background: var(--ck-color-primary); color: var(--ck-color-on-primary); }
.dots { display: flex; gap: 6px; }
.dots span { width: 7px; height: 7px; border-radius: 50%; background: var(--ck-color-text); animation: ck-pulse 1.2s ease-in-out infinite; }
.dots span:nth-child(2) { animation-delay: 0.2s; }
.dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes ck-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
.dot { display: inline-flex; align-items: center; gap: 8px; color: var(--ck-color-text); font-weight: 500; }
.dot::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--ck-color-text-muted); }
.dot[data-tone="success"]::before { background: var(--ck-color-success); }
.dot[data-tone="warning"]::before { background: var(--ck-color-warning); }
.dot[data-tone="danger"]::before { background: var(--ck-color-danger); }
.spin { animation: ck-spin 1s linear infinite; }
@keyframes ck-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin, .dots span { animation: none; } .dots span { opacity: 0.6; } }
svg { display: block; flex: none; }
@supports (color: contrast-color(red)) {
  :host { --ck-color-on-primary: contrast-color(var(--ck-color-primary)); }
}
`;
