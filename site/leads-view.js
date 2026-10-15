// Leads tab: where the ads' leads stand today in Brevo (funnel, follow-up and stage charts, table).
import * as L from "./leads.js";
import * as M from "./metrics.js";
import { el, info, drawStacked, drawBars, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);
const STEP_HELP = { leads: "formLeads", inBrevo: "inBrevo", deals: "deals", hot: "hot", won: "won" };
// Amber is reserved for the problem state; "no deal" recedes in grey so the deals stand out.
const FOLLOW_UP_COLORS = { "Not in Brevo": "--alert", "In Brevo, no deal": "--no-deal", Deal: "--deal" };

function renderLeadFunnel(container, totals, f) {
  container.replaceChildren(...L.funnel(totals).map((s) => {
    const li = el("li");
    const label = el("div", "fn-label", s.label);
    label.append(info(GLOSSARY[STEP_HELP[s.key]]));
    li.append(label, el("div", "fn-value", f.num(s.value)), el("div", "fn-rate", s.rate == null ? "" : `${f.pct(s.rate)} of ${s.of}`));
    return li;
  }));
}

const COLS = [
  { key: "total", label: "Leads", help: "formLeads" },
  { key: "missing", label: "Not in Brevo", help: "notInBrevo" },
  { key: "deals", label: "Deals", help: "deals" },
  { key: "pipeline", label: "Pipeline", help: "pipeline", cls: "col-pipeline" },
  { key: "spend", label: "Spend", help: "spend" },
  { key: "costPerDeal", label: "Cost per deal", help: "costPerDeal", cls: "col-bar" },
];

function rowEl(e, f, maxCpd, cls) {
  const tr = el("tr", cls);
  tr.append(el("td", "col-label", e.name));
  const missing = e.byStatus["Not in Brevo"];
  tr.append(el("td", null, f.num(e.total)), el("td", missing ? "alert-text" : "zero", f.num(missing)),
    el("td", e.deals ? "strong" : "zero", f.num(e.deals)), el("td", "col-pipeline", L.pipeline(e.byStatus) || "—"),
    el("td", null, f.moneyShort(e.spend)));
  const cpd = el("td", "col-bar");
  if (e.costPerDeal != null && maxCpd) {
    const bar = el("span", "cell-bar");
    bar.style.width = `${Math.max(2, (e.costPerDeal / maxCpd) * 100)}%`;
    cpd.append(bar);
  }
  cpd.append(el("span", "cell-value", f.moneyShort(e.costPerDeal)));
  tr.append(cpd);
  return tr;
}

export function renderLeads({ leadRows, rows, range, days, state, f, adsById, campaignsById }, { onLevel }) {
  const totals = L.statusTotals(leadRows);
  renderLeadFunnel($("leads-funnel"), totals, f);
  $("leads-empty").hidden = totals.total > 0;

  const bucket = M.bucketFor(days);
  $("cap-followup").textContent = `Leads ${bucket === "week" ? "per week" : "per day"}, by follow-up today`;
  const { days: dates, series } = L.followUpSeries(leadRows, range, bucket);
  drawStacked("chart-followup", dates.map((d) => f.day(d)),
    L.FOLLOW_UP.map((s) => ({ label: s === "Deal" ? "Became a deal" : s, values: series.get(s), colorVar: FOLLOW_UP_COLORS[s] })),
    f.num, f.compact);
  drawBars("chart-stages", L.PIPELINE, L.PIPELINE.map((s) => totals.byStatus[s]), "--deal", f.num);

  const level = state.leadLevel;
  $("lead-level").value = level;
  $("lead-level").onchange = (e) => onLevel(e.target.value);
  const key = level === "ad" ? "adId" : "campaignId";
  const nameOf = level === "ad"
    ? (id) => {  // ad names repeat across accounts, so show the campaign too
      const ad = id == null ? null : adsById.get(id);
      if (!ad) return id == null ? "Unknown ad" : `Ad ${id}`;
      const campaign = campaignsById.get(ad.campaignId)?.name;
      return campaign ? `${campaign} · ${ad.name}` : ad.name;
    }
    : (id) => (id == null ? "Unknown campaign" : campaignsById.get(id)?.name || `Campaign ${id}`);
  const spend = new Map([...M.groupTotals(rows, key)].map(([id, t]) => [id, t.spend]));
  const table = L.leadTable(leadRows, level, nameOf, spend, M.totals(rows).spend);
  const maxCpd = Math.max(0, ...table.rows.map((e) => e.costPerDeal ?? 0));

  const head = el("tr");
  head.append(el("th", "col-label", level === "ad" ? "Ad" : "Campaign"));
  for (const c of COLS) {
    const th = el("th", c.cls || null, c.label);
    th.append(info(GLOSSARY[c.help]));
    head.append(th);
  }
  $("lead-table").tHead.replaceChildren(head, rowEl(table.total, f, 0, "totals"));
  $("lead-table").tBodies[0].replaceChildren(...table.rows.map((e) => rowEl(e, f, maxCpd)));
}
