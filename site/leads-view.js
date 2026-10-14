// Leads tab: where the ads' leads stand today in Brevo (funnel, weekly status chart, table).
import * as L from "./leads.js";
import * as M from "./metrics.js";
import { el, info, drawStacked, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);
const STEP_HELP = { leads: "formLeads", inBrevo: "inBrevo", deals: "deals", hot: "hot", won: "won" };
export const STATUS_COLORS = { "Not in Brevo": "--st-0", "In Brevo, no deal": "--st-1", Cold: "--st-2", Warm: "--st-3",
  Hot: "--st-4", Won: "--st-5", Lost: "--st-lost" };  // st-0 is amber (a problem state), st-1..5 a blue ramp

export function renderLeadFunnel(container, totals, f, withRates) {
  container.replaceChildren(...L.funnel(totals).map((s) => {
    const li = el("li");
    const label = el("div", "lf-label", s.label);
    label.append(info(GLOSSARY[STEP_HELP[s.key]]));
    li.append(el("div", "lf-value", f.num(s.value)), label);
    if (withRates && s.rate != null) li.append(el("div", "lf-rate", `${f.pct(s.rate)} of ${s.of}`));
    return li;
  }));
}

const COLS = [
  { key: "total", label: "Leads", help: "formLeads" },
  { status: "Not in Brevo", label: "Not in Brevo", help: "notInBrevo" },
  { status: "In Brevo, no deal", label: "No deal" },
  { status: "Cold", label: "Cold" },
  { status: "Warm", label: "Warm" },
  { status: "Hot", label: "Hot", help: "hot" },
  { status: "Won", label: "Won", help: "won" },
  { status: "Lost", label: "Lost" },
  { key: "unsubscribed", label: "Unsubscribed", help: "unsubscribed" },
  { key: "deals", label: "Deals", help: "deals" },
  { key: "costPerDeal", label: "Cost per deal", help: "costPerDeal", money: true },
];

function rowEl(e, f, cls) {
  const tr = el("tr", cls);
  tr.append(el("td", "col-label", e.name));
  for (const c of COLS) {
    const v = c.status ? e.byStatus[c.status] : e[c.key];
    tr.append(el("td", null, c.money ? f.money(v) : f.num(v)));
  }
  return tr;
}

export function renderLeads({ leadRows, rows, range, state, f, adsById, campaignsById }, { onLevel }) {
  const totals = L.statusTotals(leadRows);
  renderLeadFunnel($("leads-funnel"), totals, f, true);
  $("leads-empty").hidden = totals.total > 0;

  const { weeks, series } = L.weeklyStatus(leadRows, range);
  drawStacked("chart-leadstatus", weeks.map((w) => `Week of ${f.day(w)}`),
    L.STATUSES.map((s) => ({ label: s, values: series.get(s), colorVar: STATUS_COLORS[s] })), f.num, f.compact);

  const level = state.leadLevel;
  $("lead-level").value = level;
  $("lead-level").onchange = (e) => onLevel(e.target.value);
  const key = level === "ad" ? "adId" : "campaignId";
  const nameOf = level === "ad"
    ? (id) => {  // ad names repeat across accounts, so show the campaign too
      const ad = id == null ? null : adsById.get(id);
      if (!ad) return id == null ? "Unknown ad" : `Ad ${id}`;
      const campaign = campaignsById.get(ad.campaignId)?.name;
      return campaign ? `${ad.name} · ${campaign}` : ad.name;
    }
    : (id) => (id == null ? "Unknown campaign" : campaignsById.get(id)?.name || `Campaign ${id}`);
  const spend = new Map([...M.groupTotals(rows, key)].map(([id, t]) => [id, t.spend]));
  const table = L.leadTable(leadRows, level, nameOf, spend, M.totals(rows).spend);

  const head = el("tr");
  head.append(el("th", "col-label", level === "ad" ? "Ad" : "Campaign"));
  for (const c of COLS) {
    const th = el("th", null, c.label);
    if (c.help) th.append(info(GLOSSARY[c.help]));
    head.append(th);
  }
  $("lead-table").tHead.replaceChildren(head, rowEl(table.total, f, "totals"));
  $("lead-table").tBodies[0].replaceChildren(...table.rows.map((e) => rowEl(e, f)));
}
