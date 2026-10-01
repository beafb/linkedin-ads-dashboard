// Overview tab: story, headline tiles, highlights, per-1,000 funnel, daily charts.
import * as M from "./metrics.js";
import * as I from "./insights.js";
import { el, info, countUp, drawChart, drawStacked, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);

const TILES = [
  { key: "leads", label: "Leads", good: "up" },
  { key: "cpl", label: "Cost per lead", good: "down" },
  { key: "spend", label: "Spend", good: null },
  { key: "impressions", label: "Seen by", good: "up" },
];

const ACCOUNT_COLORS = ["--series-1", "--series-2"];  // fixed per account (order in data.accounts)

function setDelta(node, d, good, hasCmp) {
  node.className = "kpi-delta";
  if (!hasCmp) { node.textContent = "Today so far, nothing to compare yet"; return; }
  if (d == null) { node.textContent = "No comparison available"; return; }
  const p = Math.round(d * 100);
  if (p === 0) { node.textContent = "= Same as the period before"; return; }
  node.textContent = `${p > 0 ? "▲" : "▼"} ${Math.abs(p)}% vs the period before`;
  if (good) node.classList.add((p > 0) === (good === "up") ? "good" : "bad");
}

function renderTiles(cur, cmp, f) {
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
  // values include today; the comparison uses complete days only (cmp)
  const pick = (t, key) => (key === "cpl" ? M.ratios(t).cpl : t[key]);
  const fmts = { leads: f.num, cpl: f.money, spend: f.money, impressions: f.num };
  for (const t of TILES) {
    const tile = box.querySelector(`[data-key="${t.key}"]`);
    countUp(tile.querySelector(".kpi-value"), pick(cur, t.key), fmts[t.key]);
    const d = cmp ? M.delta(pick(cmp.cur, t.key), pick(cmp.prev, t.key)) : null;
    setDelta(tile.querySelector(".kpi-delta"), d, t.good, Boolean(cmp));
  }
}

const highlight = (title, main, sub) => {
  const c = el("div", "highlight");
  c.append(el("div", "hl-title", title), el("div", "hl-main", main), el("div", "hl-sub", sub));
  return c;
};

function renderHighlights(rows, range, cmp, f, adsById) {
  const best = I.byLeads(I.adList(rows)).find((a) => a.leads > 0);
  const day = I.bestDay(M.byDate(rows, range));
  const cards = [];
  if (best) cards.push(highlight("🥇 Best ad", adsById.get(best.id)?.name || `Ad ${best.id}`,
    `${I.count(best.leads, "lead", f.num)} · ${f.money(best.cpl)} per lead`));
  if (day) cards.push(highlight("📅 Best day", f.longDay(day.date), I.count(day.leads, "lead", f.num)));
  cards.push(highlight("📈 Trend", I.trend(cmp), "Complete days, compared with the period just before"));
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

export function renderOverview({ rows, cmp, range, state, f, adsById, data, accounts }) {
  const cur = M.totals(rows);
  $("story").textContent = I.story(state.range, cur, cmp, f);
  renderTiles(cur, cmp, f);
  renderHighlights(rows, range, cmp, f, adsById);
  renderPer1000(cur, f);
  const series = M.byDate(rows, range);
  const labels = series.map((d) => f.day(d.date));
  drawChart("chart-leads", "bar", labels, series.map((d) => d.leads), f.num, f.compact);
  drawChart("chart-cpl", "line", labels, series.map((d) => (d.leads ? d.spend / d.leads : null)), f.money, f.compact);
  const split = M.byDateSplit(rows, range, (r) => adsById.get(r.adId)?.accountId, accounts.map((a) => a.id), "spend");
  drawStacked("chart-spend", labels, accounts.map((a) => ({
    label: a.label, values: split.series.get(a.id),
    colorVar: ACCOUNT_COLORS[data.accounts.findIndex((x) => x.id === a.id) % ACCOUNT_COLORS.length],
  })), f.money, f.compact);
}
