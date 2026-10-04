import { supportStyles } from "./styles.js";

export const adminStyles = `${supportStyles}
:host { container-type: inline-size; display: grid; min-height: 100%; }
.admin {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  min-height: 100%;
  background: var(--ck-color-background);
}
.sidebar {
  display: grid;
  align-content: start;
  gap: 28px;
  padding: 24px 16px;
  background: var(--ck-color-surface);
  border-inline-end: var(--ck-border-width) solid var(--ck-color-border);
}
.site { display: flex; align-items: center; gap: 10px; padding: 0 8px; }
.site img, .site-mark { flex: none; width: 30px; height: 30px; border-radius: 9px; object-fit: cover; }
.site-mark { display: grid; place-items: center; background: var(--ck-color-primary); color: var(--ck-color-on-primary); font-size: 13px; font-weight: 700; }
.site strong { display: block; font-size: 0.9375em; }
.site div span { display: block; font-size: 0.75em; color: var(--ck-color-text-muted); }
.nav { display: grid; gap: 2px; }
.nav button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  font: inherit;
  font-size: 0.875em;
  font-weight: 500;
  text-align: start;
  color: var(--ck-color-text);
  background: transparent;
  border: 0;
  border-radius: var(--ck-radius-control);
  cursor: pointer;
}
.nav button[aria-current="page"] { background: var(--ck-color-primary); color: var(--ck-color-on-primary); font-weight: 600; }
.nav button:focus-visible, .filter:focus-visible, .small:focus-visible, .nav-select:focus-visible { outline: 2px solid var(--ck-color-primary); outline-offset: 2px; }
.nav .count { margin-inline-start: auto; font-size: 0.857em; font-weight: 600; }
.nav-select { display: none; }

.main { display: grid; align-content: start; gap: 24px; padding: 32px 40px; min-width: 0; }
.page-head { display: grid; gap: 4px; }
.page-title { margin: 0; font-size: 1.75em; letter-spacing: -0.02em; line-height: 1.2; }
.page-title:focus-visible, .drawer-title:focus-visible { outline: 2px solid var(--ck-color-primary); outline-offset: 3px; border-radius: 2px; }
.page-sub { font-size: 0.875em; color: var(--ck-color-text-muted); max-width: 70ch; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); padding: 24px 0; background: var(--ck-color-surface); border: var(--ck-border-width) solid var(--ck-color-border); border-radius: var(--ck-radius); }
.stat { display: grid; gap: 6px; padding: 4px 28px; border-inline-start: var(--ck-border-width) solid var(--ck-color-border); }
.stat:first-child { border-inline-start: 0; }
.stat-label { font-size: 0.8125em; font-weight: 500; color: var(--ck-color-text-muted); }
.stat-values { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline; }
.stat-value { font-size: 2.5em; font-weight: 700; letter-spacing: -0.03em; line-height: 1.05; }
.stat-note { font-size: 0.8125em; color: var(--ck-color-text-muted); }

.panel { background: var(--ck-color-surface); border: var(--ck-border-width) solid var(--ck-color-border); border-radius: var(--ck-radius); overflow: hidden; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 14px 20px; border-bottom: var(--ck-border-width) solid var(--ck-color-border); }
.filter {
  display: inline-flex;
  gap: 6px;
  padding: 6px 12px;
  font: inherit;
  font-size: 0.8125em;
  font-weight: 500;
  color: var(--ck-color-text);
  background: var(--ck-color-surface);
  border: var(--ck-border-width) solid var(--ck-color-border);
  border-radius: var(--ck-radius-control);
  cursor: pointer;
}
.filter span { color: var(--ck-color-text-muted); font-weight: 600; }
.filter[aria-pressed="true"] { background: var(--ck-color-primary); border-color: var(--ck-color-primary); color: var(--ck-color-on-primary); }
.filter[aria-pressed="true"] span { color: inherit; }

table { width: 100%; border-collapse: collapse; font-size: 0.875em; }
caption { text-align: start; }
th { padding: 13px 20px; text-align: start; font-size: 0.786em; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ck-color-text-muted); }
td { padding: 18px 20px; border-top: var(--ck-border-width) solid var(--ck-color-border); vertical-align: middle; }
.num { text-align: end; white-space: nowrap; }
td.num { font-weight: 600; font-size: 1.07em; }
.muted { color: var(--ck-color-text-muted); }
.anonymous { color: var(--ck-color-text-muted); font-style: italic; }
.end { text-align: end; white-space: nowrap; }
.small {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font: inherit;
  font-size: 0.929em;
  font-weight: 500;
  color: var(--ck-color-text);
  background: var(--ck-color-surface);
  border: var(--ck-border-width) solid var(--ck-color-border);
  border-radius: var(--ck-radius-control);
  cursor: pointer;
}
.small + .small { margin-inline-start: 8px; }
.small:disabled, .filter:disabled { opacity: 0.5; cursor: default; }
.pager { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 0.8125em; color: var(--ck-color-text-muted); }
.pager div { display: flex; gap: 8px; }

.empty, .state { display: grid; justify-items: center; gap: 12px; padding: 48px 24px; text-align: center; }
.empty .status-icon, .state .status-icon { width: 48px; height: 48px; }
.empty strong, .state strong { font-size: 1.0625em; }
.empty p, .state p { color: var(--ck-color-text-muted); font-size: 0.875em; max-width: 44ch; }
.skeleton { display: grid; }
.skeleton div { display: flex; gap: 24px; padding: 20px; border-top: var(--ck-border-width) solid var(--ck-color-border); }
.skeleton div:first-child { border-top: 0; }
.skeleton span { height: 12px; border-radius: 6px; background: var(--ck-color-border); }
.skeleton .w1 { width: 90px; }
.skeleton .w2 { width: 70px; }
.skeleton .w3 { width: 140px; }

.drawer {
  position: fixed;
  inset: 0 0 0 auto;
  width: min(560px, 100vw);
  max-width: 100vw;
  height: 100dvh;
  max-height: 100dvh;
  margin: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: var(--ck-color-surface);
  box-shadow: -12px 0 40px rgb(0 0 0 / 0.18);
}
.drawer-head { display: flex; gap: 12px; align-items: start; padding: 24px 28px; border-bottom: var(--ck-border-width) solid var(--ck-color-border); }
.drawer-head > div { flex: 1; display: grid; gap: 6px; }
.drawer-title { margin: 0; font-size: 1.875em; letter-spacing: -0.02em; line-height: 1.1; }
.drawer-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 0.875em; color: var(--ck-color-text-muted); }
.drawer-body { display: grid; gap: 24px; padding: 24px 28px 40px; }
.section { display: grid; gap: 10px; }
.section-title { margin: 0; font-size: 0.8125em; font-weight: 600; letter-spacing: 0.02em; color: var(--ck-color-text-muted); }
.kv { display: grid; border: var(--ck-border-width) solid var(--ck-color-border); border-radius: var(--ck-radius-control); font-size: 0.875em; }
.kv div { display: flex; justify-content: space-between; gap: 16px; padding: 11px 14px; }
.kv div + div { border-top: var(--ck-border-width) solid var(--ck-color-border); }
.kv dt { color: var(--ck-color-text-muted); }
.kv dd { margin: 0; text-align: end; font-weight: 500; }
.banner { display: flex; gap: 12px; align-items: start; padding: 16px; border-radius: var(--ck-radius-control); background: var(--ck-color-background); font-size: 0.875em; }
.banner strong { display: block; font-size: 1.07em; margin-bottom: 4px; }
.banner p { color: var(--ck-color-text-muted); }
.banner svg { flex: none; margin-top: 2px; }
.banner[data-tone="warning"] svg { color: var(--ck-color-warning); }
.banner[data-tone="danger"] svg { color: var(--ck-color-danger); }
.banner[data-tone="success"] svg { color: var(--ck-color-success); }
.banner > div { flex: 1; }
.action-form { display: grid; gap: 12px; }
.row { display: flex; flex-wrap: wrap; gap: 10px; }
.row > * { flex: 1 1 160px; }
.links { display: flex; flex-wrap: wrap; gap: 8px; }
.button-danger { color: var(--ck-color-surface); background: var(--ck-color-danger); border: 0; }
.message-text { font-size: 0.9375em; }

.modal { width: min(440px, 100vw - 32px); padding: 0; border: 0; border-radius: var(--ck-radius); color: inherit; background: var(--ck-color-surface); box-shadow: 0 24px 60px rgb(0 0 0 / 0.25); }
.modal form { display: grid; gap: 20px; padding: 28px; }
.modal h2 { margin: 0; font-size: 1.25em; }
.modal p { color: var(--ck-color-text-muted); font-size: 0.9375em; }
.modal .row { justify-content: end; }
.modal .row > * { flex: 0 0 auto; width: auto; }

.columns { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 24px; align-items: start; }
.context-list { display: grid; gap: 8px; }
.context-item {
  display: grid;
  gap: 6px;
  padding: 16px;
  font: inherit;
  text-align: start;
  color: var(--ck-color-text);
  background: var(--ck-color-surface);
  border: var(--ck-border-width) solid var(--ck-color-border);
  border-radius: var(--ck-radius-control);
  cursor: pointer;
}
.context-item[aria-current="true"] { background: var(--ck-color-primary); border-color: var(--ck-color-primary); color: var(--ck-color-on-primary); }
.context-item[aria-current="true"] .dot, .context-item[aria-current="true"] .muted { color: inherit; }
.editor { display: grid; gap: 24px; padding: 28px; }
.editor-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.editor-head h2 { margin: 0; font-size: 1.25em; }
.check { display: flex; gap: 12px; align-items: start; font-size: 0.875em; }
.check input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--ck-color-primary); }
.check small { display: block; color: var(--ck-color-text-muted); font-size: 0.929em; }
.currency-rows { display: grid; border: var(--ck-border-width) solid var(--ck-color-border); border-radius: var(--ck-radius-control); }
.currency-row { display: grid; grid-template-columns: 64px 120px minmax(0, 1fr) 110px 110px; gap: 12px; align-items: center; padding: 12px 16px; }
.currency-row + .currency-row { border-top: var(--ck-border-width) solid var(--ck-color-border); }
.currency-row.head { padding-block: 10px; font-size: 0.75em; font-weight: 600; color: var(--ck-color-text-muted); background: var(--ck-color-background); }
.currency-row .input { min-height: 40px; padding: 8px 10px; }
.unit-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.editor-foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; padding-top: 16px; border-top: var(--ck-border-width) solid var(--ck-color-border); font-size: 0.8125em; color: var(--ck-color-text-muted); }
.editor-foot .button { width: auto; }
.export { display: grid; gap: 20px; max-width: 640px; padding: 28px; }
.export ul { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.export li { display: flex; gap: 12px; align-items: center; font-size: 0.9375em; }
.export li svg { color: var(--ck-color-text-muted); flex: none; }
.export .button { width: auto; justify-self: end; }
.slot-wrap { display: flex; justify-content: center; }

@container (max-width: 760px) {
  .admin { grid-template-columns: minmax(0, 1fr); }
  .sidebar { padding: 14px 16px; gap: 12px; border-inline-end: 0; border-bottom: var(--ck-border-width) solid var(--ck-color-border); grid-template-columns: 1fr; }
  .nav { display: none; }
  .nav-select { display: block; }
  .main { padding: 16px; gap: 16px; }
  .columns { grid-template-columns: minmax(0, 1fr); }
  .currency-row { grid-template-columns: 1fr 1fr; }
  .unit-grid { grid-template-columns: 1fr 1fr; }
  .stats { padding: 8px 0; }
  .stat { border-inline-start: 0; border-top: var(--ck-border-width) solid var(--ck-color-border); padding: 16px 24px; }
  .stat:first-child { border-top: 0; }
  .currency-row.head { display: none; }
  .currency-row > :first-child { grid-column: 1 / -1; }
  .currency-row > :nth-child(2) { grid-column: 1 / -1; }
  table.responsive thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  table.responsive, table.responsive tbody, table.responsive tr, table.responsive td { display: block; }
  table.responsive tr { padding: 14px 16px; border-top: var(--ck-border-width) solid var(--ck-color-border); }
  table.responsive tbody tr:first-child { border-top: 0; }
  table.responsive td { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border: 0; text-align: end; }
  table.responsive td::before { content: attr(data-label); color: var(--ck-color-text-muted); font-weight: 400; font-size: 0.929em; text-align: start; }
  table.responsive td.end { justify-content: flex-end; padding-top: 10px; }
  table.responsive td.end::before { content: none; }
}
`;
