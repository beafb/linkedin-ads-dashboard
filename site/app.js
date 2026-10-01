import * as M from "./metrics.js";

const RANGES = ["7d", "30d", "month", "lastmonth", "ytd", "all"];
const state = { account: "all", range: "30d", campaign: null, sortKey: "spend", sortDir: -1 };
let data = null;
const charts = {};
const $ = (id) => document.getElementById(id);

const DASH = "—";
const num = new Intl.NumberFormat("en-IE");
const pct = new Intl.NumberFormat("en-IE", { style: "percent", maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-IE", { notation: "compact" });
let money = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const fmtNum = (v) => (v == null ? DASH : num.format(Math.round(v)));
const fmtMoney = (v) => (v == null ? DASH : money.format(v));
const fmtPct = (v) => (v == null ? DASH : pct.format(v));
const fmtDay = (iso) => M.toDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const titleCase = (s) => (s ? s[0] + s.slice(1).toLowerCase() : "");
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("acc")) state.account = p.get("acc");
  if (RANGES.includes(p.get("range"))) state.range = p.get("range");
  state.campaign = p.get("c") ? Number(p.get("c")) : null;
}

function writeHash() {
  const p = new URLSearchParams({ acc: state.account, range: state.range });
  if (state.campaign) p.set("c", state.campaign);
  history.replaceState(null, "", `#${p}`);
}

const selectedAccounts = () =>
  state.account === "all" ? data.accounts : data.accounts.filter((a) => a.label === state.account);

function selectedCampaignIds() {
  const accIds = new Set(selectedAccounts().map((a) => a.id));
  const ids = data.campaigns.filter((c) => accIds.has(c.accountId)).map((c) => c.id);
  return new Set(state.campaign && ids.includes(state.campaign) ? [state.campaign] : ids);
}

function update() {
  writeHash();
  render();
}

function renderControls() {
  const labels = data.accounts.map((a) => a.label);
  if (labels.length > 1) labels.push("all");
  $("accounts").replaceChildren(...labels.map((label) => {
    const b = el("button", null, label === "all" ? (data.accounts.length === 2 ? "Both" : "All") : label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(state.account === label));
    b.onclick = () => { state.account = label; state.campaign = null; update(); };
    return b;
  }));
  $("range").value = state.range;
  const c = state.campaign && data.campaigns.find((x) => x.id === state.campaign);
  $("campaign-chip").hidden = !c;
  if (c) $("campaign-chip").textContent = `Campaign: ${c.name} ✕`;
}

function renderKpis(container, items) {
  container.replaceChildren(...items.map(({ label, value, d, good }) => {
    const tile = el("div", "kpi");
    const delta = el("div", "kpi-delta");
    if (d == null) {
      delta.textContent = "no comparison";
    } else {
      const up = d >= 0;
      delta.textContent = `${up ? "▲" : "▼"} ${pct.format(Math.abs(d))} vs previous period`;
      if (good) delta.classList.add(up === (good === "up") ? "good" : "bad");
    }
    tile.append(el("div", "kpi-label", label), el("div", "kpi-value", value), delta);
    return tile;
  }));
}

function renderFunnel(t, r) {
  const steps = [
    ["Impressions", t.impressions, null],
    ["Clicks", t.clicks, r.ctr],
    ["Lead-form opens", t.leadFormOpens, r.clickToForm],
    ["Leads", t.leads, r.formRate],
  ];
  $("funnel").replaceChildren(...steps.map(([label, value, rate]) => {
    const li = el("li");
    li.append(el("div", "step", label), el("div", "value", fmtNum(value)),
      el("div", "rate", rate == null && label === "Impressions" ? " " : `${fmtPct(rate)} of previous step`));
    return li;
  }));
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawChart(id, type, labels, values, fmt) {
  charts[id]?.destroy();
  const series = cssVar("--series-1");
  const muted = cssVar("--text-muted");
  const grid = cssVar("--grid");
  charts[id] = new Chart($(id), {
    type,
    data: {
      labels,
      datasets: [{
        data: values, backgroundColor: series, borderColor: series, borderWidth: 2,
        borderRadius: 4, maxBarThickness: 18, categoryPercentage: 0.9, barPercentage: 0.9,
        pointHoverRadius: 4,
        // show a dot only for isolated values, otherwise a line with gaps would hide them
        pointRadius: (ctx) => {
          const d = ctx.dataset.data, i = ctx.dataIndex;
          return d[i] != null && d[i - 1] == null && d[i + 1] == null ? 4 : 0;
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { label: (ctx) => fmt(ctx.parsed.y) } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: grid }, ticks: { color: muted, maxTicksLimit: 6, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false },
             ticks: { color: muted, maxTicksLimit: 5, callback: (v) => compact.format(v) } },
      },
    },
  });
}

const COLS = [
  { key: "name", label: "Campaign" },
  { key: "group", label: "Group" },
  { key: "status", label: "Status" },
  { key: "dailyBudget", label: "Daily budget", fmt: (v) => fmtMoney(v) },
  { key: "impressions", label: "Impressions", fmt: fmtNum },
  { key: "clicks", label: "Clicks", fmt: fmtNum },
  { key: "ctr", label: "CTR", fmt: fmtPct },
  { key: "spend", label: "Spend", fmt: fmtMoney },
  { key: "leads", label: "Leads", fmt: fmtNum },
  { key: "cpl", label: "CPL", fmt: fmtMoney },
];

function renderTable(rows) {
  const byC = M.byCampaign(rows);
  const list = data.campaigns
    .filter((c) => (byC.get(c.id)?.impressions || 0) > 0)
    .map((c) => {
      const t = byC.get(c.id);
      return { ...c, ...t, ...M.ratios(t), status: titleCase(c.status) };
    });
  const { sortKey: k, sortDir: dir } = state;
  list.sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
  });

  const head = el("tr");
  for (const col of COLS) {
    const th = el("th");
    th.scope = "col";
    if (col.key === k) th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
    const b = el("button", null, col.label + (col.key === k ? (dir < 0 ? " ↓" : " ↑") : ""));
    b.type = "button";
    b.onclick = () => {
      state.sortDir = state.sortKey === col.key ? -state.sortDir : (col.fmt ? -1 : 1);
      state.sortKey = col.key;
      render();
    };
    th.append(b);
    head.append(th);
  }
  $("campaigns").tHead.replaceChildren(head);

  $("campaigns").tBodies[0].replaceChildren(...list.map((c) => {
    const tr = el("tr");
    tr.tabIndex = 0;
    tr.title = state.campaign === c.id ? "Click to show all campaigns" : "Click to filter the page to this campaign";
    const toggle = () => { state.campaign = state.campaign === c.id ? null : c.id; update(); };
    tr.onclick = toggle;
    tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
    for (const col of COLS) tr.append(el("td", null, col.fmt ? col.fmt(c[col.key]) : c[col.key] || DASH));
    return tr;
  }));
  $("no-campaigns").hidden = list.length > 0;
}

function render() {
  const today = M.todayIso();
  const firstDate = data.daily.length ? data.daily[0].date : today;
  const range = M.rangeFor(state.range, today, firstDate);
  const ids = selectedCampaignIds();
  const rows = M.filterRows(data.daily, range, ids);
  const cur = M.totals(rows);
  const prev = M.totals(M.filterRows(data.daily, M.previousRange(range), ids));
  const r = M.ratios(cur);
  const pr = M.ratios(prev);
  money = new Intl.NumberFormat("en-IE", { style: "currency", currency: selectedAccounts()[0]?.currency || "EUR" });

  renderControls();
  renderKpis($("lead-kpis"), [
    { label: "Leads", value: fmtNum(cur.leads), d: M.delta(cur.leads, prev.leads), good: "up" },
    { label: "Cost per lead", value: fmtMoney(r.cpl), d: M.delta(r.cpl, pr.cpl), good: "down" },
    { label: "Spend", value: fmtMoney(cur.spend), d: M.delta(cur.spend, prev.spend), good: null },
    { label: "Form completion", value: fmtPct(r.formRate), d: M.delta(r.formRate, pr.formRate), good: "up" },
  ]);
  renderFunnel(cur, r);
  renderKpis($("funnel-kpis"), [
    { label: "Click-through rate", value: fmtPct(r.ctr), d: M.delta(r.ctr, pr.ctr), good: "up" },
    { label: "Cost per click", value: fmtMoney(r.cpc), d: M.delta(r.cpc, pr.cpc), good: "down" },
    { label: "Cost per 1,000 impressions", value: fmtMoney(r.cpm), d: M.delta(r.cpm, pr.cpm), good: "down" },
  ]);

  const days = M.byDate(rows, range);
  const labels = days.map((d) => fmtDay(d.date));
  drawChart("chart-leads", "bar", labels, days.map((d) => d.leads), fmtNum);
  drawChart("chart-cpl", "line", labels, days.map((d) => (d.leads ? d.spend / d.leads : null)), fmtMoney);
  drawChart("chart-impressions", "line", labels, days.map((d) => d.impressions), fmtNum);
  drawChart("chart-clicks", "bar", labels, days.map((d) => d.clicks), fmtNum);
  renderTable(rows);
}

async function init() {
  readHash();
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    $("error").textContent = `Could not load the data (${e.message}). The next scheduled refresh should fix this.`;
    $("error").hidden = false;
    return;
  }
  const labels = data.accounts.map((a) => a.label);
  if (labels.length === 1) state.account = labels[0];
  else if (!labels.includes(state.account)) state.account = "all";
  $("updated").textContent = `Last updated ${new Date(data.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;
  $("range").onchange = (e) => { state.range = e.target.value; update(); };
  $("campaign-chip").onclick = () => { state.campaign = null; update(); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  update();
}

init();
