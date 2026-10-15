// Ads tab: one sortable row per ad (campaign first, results, deals, trend sparkline, verdict).
import * as M from "./metrics.js";
import * as I from "./insights.js";
import * as L from "./leads.js";
import { el, info, sparkline, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);

const COLS = [
  { key: "campaignName", label: "Ad", cls: "col-label", dir: "asc" },
  { key: "status", label: "Status", cls: "col-status", dir: "asc" },
  { key: "leads", label: "Leads", help: "leads" },
  { key: "cpl", label: "Cost per lead", help: "cpl", dir: "asc" },
  { key: "ctr", label: "Click rate", help: "ctr" },
  { key: "spend", label: "Spend", help: "spend" },
  { key: "deals", label: "Deals", help: "deals" },
  { key: null, label: "Leads trend", cls: "col-spark" },
  { key: "verdictRank", label: "Verdict", cls: "col-verdict" },
];
const VERDICT_ORDER = ["dealMaker", "deals", "cheapNoDeal", "solid", "costly", "noLeads", "early"];
const statusClass = (s) => `pill pill-${s.toLowerCase().replace(/\s+/g, "-")}`;
const isGenerated = (name, id) => !name || name === `Ad ${id}`;

function headRow(sort, onSort) {
  const tr = el("tr");
  for (const c of COLS) {
    const th = el("th", c.cls || null);
    if (c.key) {
      const active = sort.key === c.key;
      th.setAttribute("aria-sort", active ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
      const btn = el("button", "sort", c.label);
      btn.type = "button";
      if (active) btn.append(el("span", "sort-arrow", sort.dir === "asc" ? "▲" : "▼"));
      btn.onclick = () => onSort({ key: c.key, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : (c.dir || "desc") });
      th.append(btn);
    } else {
      th.textContent = c.label;
    }
    if (c.help) th.append(info(GLOSSARY[c.help]));
    tr.append(th);
  }
  return tr;
}

function adRow(a, f, showAccount, onSeeDaily) {
  const tr = el("tr", a.running ? null : "inactive");
  const name = el("td", "col-label");
  const title = el("button", "ad-title", a.campaignName);
  title.type = "button";
  title.title = "See this ad's daily numbers";
  title.onclick = () => onSeeDaily(a.id);
  const sub = el("div", "ad-sub",
    `${isGenerated(a.adName, a.id) ? "" : `${a.adName} · `}ID ${a.id}${showAccount && a.account ? ` · ${a.account}` : ""}`);
  name.append(title, sub);

  const status = el("td", "col-status");
  status.append(el("span", statusClass(a.status), a.status));

  const v = I.VERDICTS[a.verdict];
  const verdict = el("td", "col-verdict");
  const badge = el("span", `badge badge-${a.running ? v.tone : "neutral"}`, v.label);
  verdict.append(badge, info(v.help));

  const spark = el("td", "col-spark");
  spark.append(sparkline(a.spark));

  tr.append(name, status,
    el("td", null, f.num(a.leads)), el("td", null, f.money(a.cpl)), el("td", null, f.pct(a.ctr)),
    el("td", null, f.moneyShort(a.spend)), el("td", a.deals ? "strong" : "zero", f.num(a.deals)),
    spark, verdict);
  return tr;
}

export function renderAds({ rows, range, days, state, f, adsById, campaignsById, leadRows, data }, { onSort, onRunningOnly, onSeeDaily }) {
  const toggle = $("running-only");
  toggle.checked = state.runningOnly;
  toggle.onchange = (e) => onRunningOnly(e.target.checked);

  const deals = L.dealsBy(leadRows, "adId");
  const total = M.totals(rows);
  const totalDeals = [...deals.values()].reduce((s, n) => s + n, 0);
  const avg = { cpl: M.ratios(total).cpl, costPerDeal: totalDeals ? total.spend / totalDeals : null };
  const bucket = M.bucketFor(days);
  const accountLabel = new Map(data.accounts.map((acc) => [acc.id, acc.label]));

  const all = I.adList(rows).filter((a) => a.impressions > 0).map((a) => {
    const ad = adsById.get(a.id);
    const status = ad?.status || "Ended";
    const row = { ...a, deals: deals.get(a.id) || 0, status, running: status === "Running",
      adName: ad?.name, account: accountLabel.get(ad?.accountId),
      campaignName: campaignsById.get(ad?.campaignId)?.name || "Unknown campaign" };
    row.verdict = I.verdict(row, avg);
    row.verdictRank = VERDICT_ORDER.length - VERDICT_ORDER.indexOf(row.verdict);  // desc = best first
    row.spark = M.byBucket(rows.filter((r) => r.adId === a.id), range, bucket).map((d) => d.leads);
    return row;
  });
  const list = state.runningOnly ? all.filter((a) => a.running) : all;

  $("ads-table").tHead.replaceChildren(headRow(state.sort, onSort));
  $("ads-table").tBodies[0].replaceChildren(
    ...I.sortBy(list, state.sort.key, state.sort.dir).map((a) => adRow(a, f, state.account === "all", onSeeDaily)));
  $("ads-table").closest(".sheet-wrap").hidden = !list.length;
  const empty = $("ads-empty");
  empty.hidden = list.length > 0;
  empty.textContent = all.length ? `None of the ${all.length} ads that ran in this period is running now.` : "No ads ran in this period.";
  if (all.length && !list.length) {
    const show = el("button", "link", "Show all ads");
    show.type = "button";
    show.onclick = () => onRunningOnly(false);
    empty.append(" ", show);
  }
}
