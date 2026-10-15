// Overview tab: four headline tiles, the Brevo alert, one ads-to-deals funnel, three time charts.
import * as M from "./metrics.js";
import * as I from "./insights.js";
import * as L from "./leads.js";
import { el, info, icon, countUp, drawChart, drawStacked, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);

const TILES = [
  { key: "spend", label: "Spend", good: null },
  { key: "leads", label: "Leads", good: "up" },
  { key: "cpl", label: "Cost per lead", good: "down" },
  { key: "costPerDeal", label: "Cost per deal" },  // no delta: recent leads haven't had time to become deals
];

export const ACCOUNT_COLORS = ["--acc-1", "--acc-2"];  // fixed per account (order in data.accounts)

function setDelta(node, d, good) {
  node.className = "kpi-delta";
  node.hidden = d == null;  // nothing to compare (first period, or today only): say nothing
  if (d == null) return;
  const p = Math.round(d * 100);
  if (p === 0) { node.textContent = "Same as the period before"; return; }
  node.textContent = `${p > 0 ? "▲" : "▼"} ${Math.abs(p)}% vs the period before`;
  if (good) node.classList.add((p > 0) === (good === "up") ? "good" : "bad");
}

function renderTiles(cur, cmp, deals, f) {
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
  const values = { spend: cur.spend, leads: cur.leads, cpl: pick(cur, "cpl"), costPerDeal: deals ? cur.spend / deals : null };
  const fmts = { spend: f.moneyShort, leads: f.num, cpl: f.money, costPerDeal: f.moneyShort };
  for (const t of TILES) {
    const tile = box.querySelector(`[data-key="${t.key}"]`);
    countUp(tile.querySelector(".kpi-value"), values[t.key], fmts[t.key]);
    const delta = tile.querySelector(".kpi-delta");
    if (t.key === "costPerDeal") {
      delta.className = "kpi-delta";
      delta.hidden = false;
      delta.textContent = deals ? `${I.count(deals, "deal", f.num)} in Brevo` : "No deal yet";
    } else {
      setDelta(delta, cmp ? M.delta(pick(cmp.cur, t.key), pick(cmp.prev, t.key)) : null, t.good);
    }
  }
}

function renderWarning(t, f, onShowLeads) {
  const missing = t.byStatus["Not in Brevo"];
  const warn = $("lead-warning");
  warn.hidden = !missing;
  if (!missing) return;
  const link = el("button", "link", "See which campaigns");
  link.type = "button";
  link.append(icon("arrowRight"));
  link.onclick = onShowLeads;
  warn.replaceChildren(icon("alert", "icon warning-icon"),
    el("span", null, `${I.count(missing, "lead", f.num)} from this period ${missing === 1 ? "is" : "are"} `
      + `not in Brevo yet, so nobody can follow ${missing === 1 ? "it" : "them"} up.`), link);
}

function renderFunnel(cur, t, f) {
  const help = { ...GLOSSARY };
  if (t.total && t.total !== cur.leads) {  // explain the gap instead of showing two unexplained numbers
    help.leads = `${GLOSSARY.leads} LinkedIn's ad reports count ${f.num(cur.leads)}; its lead-form export, `
      + `used for the Brevo steps, has ${f.num(t.total)}. "In Brevo" is a share of those ${f.num(t.total)}.`;
  }
  $("funnel").replaceChildren(...L.fullFunnel(cur, t).map((s) => {
    const li = el("li");
    const label = el("div", "fn-label", s.label);
    label.append(info(help[s.key]));
    li.append(label, el("div", "fn-value", f.num(s.value)));
    li.append(el("div", "fn-rate", s.rate == null ? "" : `${f.pct(s.rate)} of ${s.of}`));
    return li;
  }));
}

export function renderOverview({ rows, cmp, range, days, f, adsById, data, accounts, leadRows }, { onShowLeads }) {
  const cur = M.totals(rows);
  const t = L.statusTotals(leadRows);
  renderTiles(cur, cmp, t.deals, f);
  renderWarning(t, f, onShowLeads);
  renderFunnel(cur, t, f);

  const bucket = M.bucketFor(days);
  const per = bucket === "week" ? "per week" : "per day";
  $("cap-leads").textContent = `Leads ${per}`;
  $("cap-cpl").textContent = `Cost per lead ${per} · dashed line: period average`;
  $("cap-spend").textContent = `Spend ${per}, by account`;
  const series = M.byBucket(rows, range, bucket);
  const labels = series.map((d) => f.day(d.date));
  drawChart("chart-leads", "bar", labels, series.map((d) => d.leads), f.num, f.compact);
  drawChart("chart-cpl", "line", labels, series.map((d) => (d.leads ? d.spend / d.leads : null)), f.money, f.moneyTick,
    { average: M.ratios(cur).cpl });
  const split = M.byBucketSplit(rows, range, bucket, (r) => adsById.get(r.adId)?.accountId, accounts.map((a) => a.id), "spend");
  drawStacked("chart-spend", labels, accounts.map((a) => ({
    label: a.name, values: split.series.get(a.id),
    colorVar: ACCOUNT_COLORS[data.accounts.findIndex((x) => x.id === a.id) % ACCOUNT_COLORS.length],
  })), f.money, f.moneyTick);
}
