// Overview tab: story, headline tiles, highlights, per-1,000 funnel, daily charts.
import * as M from "./metrics.js";
import * as I from "./insights.js";
import { el, info, countUp, drawChart, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);

const TILES = [
  { key: "leads", label: "Leads", good: "up" },
  { key: "cpl", label: "Cost per lead", good: "down" },
  { key: "spend", label: "Spend", good: null },
  { key: "impressions", label: "Seen by", good: "up" },
];

function setDelta(node, d, good, phrase) {
  node.className = "kpi-delta";
  if (d == null) { node.textContent = "No earlier data to compare"; return; }
  const p = Math.round(d * 100);
  if (p === 0) { node.textContent = `= Same as ${phrase}`; return; }
  node.textContent = `${p > 0 ? "▲" : "▼"} ${Math.abs(p)}% vs ${phrase}`;
  if (good) node.classList.add((p > 0) === (good === "up") ? "good" : "bad");
}

function renderTiles(cur, prev, days, f) {
  const box = $("tiles");
  if (box.dataset.ready !== "1") {
    box.replaceChildren(...TILES.map((t) => {
      const tile = el("div", "kpi");
      tile.dataset.key = t.key;
      const label = el("div", "kpi-label", t.label);
      label.append(info(GLOSSARY[t.key]));
      tile.append(label, el("div", "kpi-value"), el("div", "kpi-delta"));
      return tile;
    }));
    box.dataset.ready = "1";
  }
  const r = M.ratios(cur), pr = M.ratios(prev);
  const values = {
    leads: [cur.leads, prev.leads, f.num], cpl: [r.cpl, pr.cpl, f.money],
    spend: [cur.spend, prev.spend, f.money], impressions: [cur.impressions, prev.impressions, f.num],
  };
  for (const t of TILES) {
    const tile = box.querySelector(`[data-key="${t.key}"]`);
    const [v, p, fmt] = values[t.key];
    countUp(tile.querySelector(".kpi-value"), v, fmt);
    setDelta(tile.querySelector(".kpi-delta"), M.delta(v, p), t.good, I.previousPhrase(days));
  }
}

const highlight = (title, main, sub) => {
  const c = el("div", "highlight");
  c.append(el("div", "hl-title", title), el("div", "hl-main", main), el("div", "hl-sub", sub));
  return c;
};

function renderHighlights(rows, range, cur, prev, f, adsById) {
  const best = I.byLeads(I.adList(rows)).find((a) => a.leads > 0);
  const day = I.bestDay(M.byDate(rows, range));
  const cards = [];
  if (best) cards.push(highlight("🥇 Best ad", adsById.get(best.id)?.name || `Ad ${best.id}`,
    `${f.num(best.leads)} leads · ${f.money(best.cpl)} per lead`));
  if (day) cards.push(highlight("📅 Best day", f.longDay(day.date), `${f.num(day.leads)} leads`));
  cards.push(highlight("📈 Trend", I.trend(cur, prev), "Compared with the period just before"));
  $("highlights").replaceChildren(...cards);
}

function renderPer1000(cur, f) {
  const p = I.per1000(cur);
  $("per1000-section").hidden = !p;
  if (!p) return;
  const steps = [["1,000", "people saw your ads"], [f.per1000(p.clicks), "clicked on an ad"],
    [f.per1000(p.formOpens), "opened the form"], [f.per1000(p.leads), "sent it and became leads"]];
  $("per1000").replaceChildren(...steps.map(([v, text]) => {
    const li = el("li");
    li.append(el("div", "p-value", v), el("div", "p-text", text));
    return li;
  }));
}

export function renderOverview({ rows, prevRows, range, days, state, f, adsById }) {
  const cur = M.totals(rows), prev = M.totals(prevRows);
  $("story").textContent = I.story(state.range, cur, prev, days, f);
  renderTiles(cur, prev, days, f);
  renderHighlights(rows, range, cur, prev, f, adsById);
  renderPer1000(cur, f);
  const series = M.byDate(rows, range);
  const labels = series.map((d) => f.day(d.date));
  drawChart("chart-leads", "bar", labels, series.map((d) => d.leads), f.num, f.compact);
  drawChart("chart-cpl", "line", labels, series.map((d) => (d.leads ? d.spend / d.leads : null)), f.money, f.compact);
}
