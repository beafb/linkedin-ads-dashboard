// Shared DOM helpers: element builder, formatters, glossary, icons, info tooltips, count-up, charts, sparklines.
import { toDate } from "./metrics.js";

export const DASH = "—";

export const GLOSSARY = {
  impressions: "Impressions: how many times your ads were shown on screen (one person can see an ad several times).",
  clicks: "Clicks: how many times someone clicked your ad.",
  ctr: "Click rate (CTR): out of 100 people who saw the ad, how many clicked.",
  leadFormOpens: "Form opens: how many people opened your lead form.",
  leads: "Leads: people who filled in and sent your form.",
  cpl: "Cost per lead: what you paid on average for each lead (spend ÷ leads).",
  spend: "Spend: what LinkedIn charged for the period.",
  formRate: "Form completion: out of 100 people who opened the form, how many sent it.",
  formLeads: "Leads (forms): people who sent your LinkedIn form. Can differ slightly from the ad-reported leads, which LinkedIn counts separately.",
  inBrevo: "In Brevo: leads found in your Brevo contacts (matched by email).",
  notInBrevo: "Not in Brevo: leads that were never added to Brevo, so nobody can follow them up.",
  deals: "Deals: leads with an opportunity in your Brevo sales pipeline (Cold, Warm, Hot, Won or Lost).",
  hot: "Hot: deals marked Hot in your pipeline.",
  won: "Won: deals marked Won in your pipeline.",
  costPerDeal: "Cost per deal: ad spend ÷ number of deals.",
  pipeline: "Pipeline: where those deals stand today in Brevo (Cold, Warm, Hot, Won, Lost).",
};

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function formatters(currency) {
  const num = new Intl.NumberFormat("en-IE");
  const money = new Intl.NumberFormat("en-IE", { style: "currency", currency });
  const pct = new Intl.NumberFormat("en-IE", { style: "percent", maximumFractionDigits: 2 });
  const money0 = new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 });
  const moneyK = new Intl.NumberFormat("en-IE", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  const compact = new Intl.NumberFormat("en-IE", { notation: "compact" });
  const date = (iso, opts) => toDate(iso).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  return {
    num: (v) => (v == null ? DASH : num.format(Math.round(v))),
    money: (v) => (v == null ? DASH : money.format(v)),
    pct: (v) => (v == null ? DASH : pct.format(v)),
    compact: (v) => compact.format(v),
    moneyTick: (v) => moneyK.format(v),  // axis ticks: €150, €1.5K
    // Totals don't need cents: €28.6K, €1,301, but €14.80 for small unit costs
    moneyShort: (v) => (v == null ? DASH : Math.abs(v) >= 10000 ? moneyK.format(v)
      : Math.abs(v) >= 100 ? money0.format(v) : money.format(v)),
    day: (iso) => date(iso, { day: "numeric", month: "short" }),
    longDay: (iso) => date(iso, { weekday: "long", day: "numeric", month: "short" }),
    sheetDay: (iso) => date(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
  };
}

// Monochrome line icons (Lucide, ISC licence), drawn in currentColor.
const ICONS = {
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
};
export function icon(name, cls = "icon") {
  const span = el("span", cls);
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

let tipCount = 0;
export function info(text) {
  const wrap = el("span", "info");
  const btn = el("button", "info-btn");
  btn.append(icon("info"));
  btn.type = "button";
  btn.setAttribute("aria-label", "What does this mean?");
  const tip = el("span", "info-tip", text);
  tip.id = `tip-${++tipCount}`;
  tip.setAttribute("role", "tooltip");
  btn.setAttribute("aria-describedby", tip.id);
  btn.addEventListener("keydown", (e) => { if (e.key === "Escape") btn.blur(); });
  wrap.append(btn, tip);
  return wrap;
}

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
export function countUp(node, target, format) {
  const from = node._value ?? 0;
  node._value = target;
  if (target == null || reduceMotion.matches || document.hidden || from === target) {
    node.textContent = format(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    if (node._value !== target) return;  // a newer render took over
    const p = Math.min((now - start) / 600, 1);
    node.textContent = format(from + (target - from) * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const charts = {};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Same ticks on every time chart whatever its width: the labels shown depend only on the number of buckets.
function timeAxis(labels, grid, muted, stacked = false) {
  const every = Math.max(1, Math.ceil(labels.length / 6));
  return {
    stacked, offset: true, grid: { display: false }, border: { color: grid },
    ticks: { color: muted, autoSkip: false, maxRotation: 0,
             callback: (v, i) => (i % every === 0 ? labels[i] : null) },
  };
}
const valueAxis = (grid, muted, tick, stacked = false) => ({
  stacked, beginAtZero: true, grid: { color: grid }, border: { display: false },
  ticks: { color: muted, maxTicksLimit: 5, callback: (v) => tick(v) },
});

// One series over time. `opts.average` adds a dashed reference line (e.g. the period's cost per lead).
export function drawChart(id, type, labels, values, fmt, tick, opts = {}) {
  charts[id]?.destroy();
  const series = cssVar("--series-1"), muted = cssVar("--text-muted"), grid = cssVar("--grid");
  const datasets = [{
    label: opts.label || "", data: values, backgroundColor: series, borderColor: series, borderWidth: 2,
    borderRadius: 4, maxBarThickness: 18, categoryPercentage: 0.9, barPercentage: 0.9,
    pointHoverRadius: 4, spanGaps: false,
    // show a dot only for isolated values, otherwise a line with gaps would hide them
    pointRadius: (ctx) => {
      const d = ctx.dataset.data, i = ctx.dataIndex;
      return d[i] != null && d[i - 1] == null && d[i + 1] == null ? 4 : 0;
    },
  }];
  if (opts.average != null) {
    datasets.push({ type: "line", label: "Average", data: labels.map(() => opts.average), borderColor: muted,
      borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0 });
  }
  charts[id] = new Chart(document.getElementById(id), {
    type,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, filter: (it) => it.parsed.y != null,
          callbacks: { label: (ctx) => (ctx.datasetIndex ? `Average: ${fmt(ctx.parsed.y)}` : fmt(ctx.parsed.y)) } },
      },
      scales: { x: timeAxis(labels, grid, muted), y: valueAxis(grid, muted, tick) },
    },
  });
}

// Stacked bars, one dataset per entity; colours are fixed per entity by the caller.
export function drawStacked(id, labels, datasets, fmt, tick) {
  charts[id]?.destroy();
  const muted = cssVar("--text-muted"), grid = cssVar("--grid"), surface = cssVar("--surface-2");
  const secondary = cssVar("--text-secondary");
  charts[id] = new Chart(document.getElementById(id), {
    type: "bar",
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label, data: d.values, backgroundColor: cssVar(d.colorVar),
        borderColor: surface, borderWidth: { top: i ? 2 : 0 }, borderSkipped: false,  // 2px gap between segments
        borderRadius: i === datasets.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
        maxBarThickness: 22, categoryPercentage: 0.9, barPercentage: 0.9,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "top", align: "start",
                  labels: { color: secondary, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
            footer: (items) => `Total: ${fmt(items.reduce((s, it) => s + it.parsed.y, 0))}`,
          },
        },
      },
      scales: { x: timeAxis(labels, grid, muted, true), y: valueAxis(grid, muted, tick, true) },
    },
  });
}

// Horizontal bars for a handful of categories, values written at the end of each bar.
export function drawBars(id, labels, values, colorVar, fmt) {
  charts[id]?.destroy();
  const color = cssVar(colorVar), muted = cssVar("--text-muted"), secondary = cssVar("--text-secondary");
  charts[id] = new Chart(document.getElementById(id), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 4, maxBarThickness: 22 }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { right: 28 } },
      plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: (ctx) => fmt(ctx.parsed.x) } } },
      scales: {
        x: { display: false, beginAtZero: true },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: secondary } },
      },
    },
    plugins: [{
      id: "values",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = muted;
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textBaseline = "middle";
        chart.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(fmt(values[i]), bar.x + 6, bar.y));
        ctx.restore();
      },
    }],
  });
}

export function sparkline(values) {
  const ns = "http://www.w3.org/2000/svg", w = 120, h = 32;
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? w / (values.length - 1) : 0;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", values.map((v, i) => `${(i * stepX).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" "));
  for (const [k, v] of [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"],
    ["stroke-linejoin", "round"], ["vector-effect", "non-scaling-stroke"]]) line.setAttribute(k, v);
  svg.append(line);
  return svg;
}
