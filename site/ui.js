// Shared DOM helpers: element builder, formatters, glossary, ⓘ tooltips, count-up, charts, sparklines.
import { toDate } from "./metrics.js";

export const DASH = "—";

export const GLOSSARY = {
  impressions: "Seen by (impressions): how many times your ads were shown on screen.",
  clicks: "Clicks: how many times someone clicked your ad.",
  ctr: "Click rate (CTR): out of 100 people who saw the ad, how many clicked.",
  leadFormOpens: "Form opens: how many people opened your lead form.",
  leads: "Leads: people who filled in and sent your form.",
  cpl: "Cost per lead: what you paid on average for each lead (spend ÷ leads).",
  spend: "Spend: what LinkedIn charged for the period.",
  formRate: "Form completion: out of 100 people who opened the form, how many sent it.",
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
  const compact = new Intl.NumberFormat("en-IE", { notation: "compact" });
  const date = (iso, opts) => toDate(iso).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  return {
    num: (v) => (v == null ? DASH : num.format(Math.round(v))),
    money: (v) => (v == null ? DASH : money.format(v)),
    pct: (v) => (v == null ? DASH : pct.format(v)),
    compact: (v) => compact.format(v),
    per1000: (v) => (v < 10 ? v.toFixed(1) : num.format(Math.round(v))),
    day: (iso) => date(iso, { day: "numeric", month: "short" }),
    longDay: (iso) => date(iso, { weekday: "long", day: "numeric", month: "short" }),
    sheetDay: (iso) => date(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
  };
}

let tipCount = 0;
export function info(text) {
  const wrap = el("span", "info");
  const btn = el("button", "info-btn", "ⓘ");
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

export function drawChart(id, type, labels, values, fmt, tick) {
  charts[id]?.destroy();
  const series = cssVar("--series-1"), muted = cssVar("--text-muted"), grid = cssVar("--grid");
  charts[id] = new Chart(document.getElementById(id), {
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
             ticks: { color: muted, maxTicksLimit: 5, callback: (v) => tick(v) } },
      },
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
      scales: {
        x: { stacked: true, grid: { display: false }, border: { color: grid }, ticks: { color: muted, maxTicksLimit: 8, maxRotation: 0 } },
        y: { stacked: true, beginAtZero: true, grid: { color: grid }, border: { display: false },
             ticks: { color: muted, maxTicksLimit: 5, callback: (v) => tick(v) } },
      },
    },
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
