// Lead status (LinkedIn forms joined with Brevo): filters, totals, funnel, follow-up series, pipeline, table. Pure.
import { buckets, weekStart } from "./metrics.js";

export const STATUSES = ["Not in Brevo", "In Brevo, no deal", "Cold", "Warm", "Hot", "Won", "Lost"];
const DEAL_STATUSES = ["Cold", "Warm", "Hot", "Won", "Lost"];

export function filterLeadRows(rows, { start, end }, accountIds, campaignId) {
  return rows.filter((r) => r.date >= start && r.date <= end && accountIds.has(r.accountId)
    && (!campaignId || r.campaignId === campaignId));
}

export function statusTotals(rows) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let total = 0, unsubscribed = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + r.count;
    total += r.count;
    unsubscribed += r.unsubscribed || 0;
  }
  const deals = DEAL_STATUSES.reduce((s, k) => s + byStatus[k], 0);
  return { total, byStatus, unsubscribed, inBrevo: total - byStatus["Not in Brevo"], deals, hot: byStatus.Hot, won: byStatus.Won };
}

// Each lead has one status, so Hot and Won are both shares of deals (a Won lead was never counted as Hot).
export function funnel(t) {
  const step = (key, label, value, base, of) => ({ key, label, value, of, rate: base ? value / base : null });
  return [
    { ...step("leads", "Leads (forms)", t.total, 0, null), rate: null },
    step("inBrevo", "In Brevo", t.inBrevo, t.total, "previous step"),
    step("deals", "Deals", t.deals, t.inBrevo, "previous step"),
    step("hot", "Hot", t.hot, t.deals, "deals"),
    step("won", "Won", t.won, t.deals, "deals"),
  ];
}

// Overview funnel, ads to CRM. Ad steps use LinkedIn's ad reports; the Brevo steps use the lead-form export,
// so "In Brevo" is a share of form leads (the two lead counts can differ slightly).
export function fullFunnel(ad, t) {
  const rate = (v, base) => (base ? v / base : null);
  const steps = [
    { key: "impressions", label: "Impressions", value: ad.impressions, rate: null },
    { key: "clicks", label: "Clicks", value: ad.clicks, rate: rate(ad.clicks, ad.impressions), of: "impressions" },
    { key: "leads", label: "Leads", value: ad.leads, rate: rate(ad.leads, ad.clicks), of: "clicks" },
  ];
  if (!t.total) return steps;
  return [...steps,
    { key: "inBrevo", label: "In Brevo", value: t.inBrevo, rate: rate(t.inBrevo, t.total), of: "leads" },
    { key: "deals", label: "Deals", value: t.deals, rate: rate(t.deals, t.inBrevo), of: "in Brevo" },
    { key: "won", label: "Won", value: t.won, rate: rate(t.won, t.deals), of: "deals" },
  ];
}

// Follow-up view for the chart: deal stages fold into one "Deal" series (the stages get their own chart).
export const FOLLOW_UP = ["Not in Brevo", "In Brevo, no deal", "Deal"];
const followUpOf = (status) => (DEAL_STATUSES.includes(status) ? "Deal" : status);

export function followUpSeries(rows, range, bucket) {
  const key = bucket === "week" ? weekStart : (iso) => iso;
  const days = buckets(range, bucket);
  const index = new Map(days.map((d, i) => [d, i]));
  const series = new Map(FOLLOW_UP.map((s) => [s, days.map(() => 0)]));
  for (const r of rows) {
    const i = index.get(key(r.date)), s = series.get(followUpOf(r.status));
    if (i != null && s) s[i] += r.count;
  }
  return { days, series };
}

export const PIPELINE = DEAL_STATUSES;

// "4 warm · 2 hot · 1 won": only the stages that have deals, in pipeline order.
export function pipeline(byStatus) {
  return PIPELINE.filter((s) => byStatus[s]).map((s) => `${byStatus[s]} ${s.toLowerCase()}`).join(" · ");
}

export function dealsBy(rows, key) {
  const out = new Map();
  for (const r of rows) if (DEAL_STATUSES.includes(r.status)) out.set(r[key], (out.get(r[key]) || 0) + r.count);
  return out;
}

export function leadTable(rows, level, nameOf, spendById, totalSpend) {
  const key = level === "ad" ? "adId" : "campaignId";
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r[key])) groups.set(r[key], []);
    groups.get(r[key]).push(r);
  }
  const entry = (id, rs, spend) => {
    const t = statusTotals(rs);
    return { id, name: nameOf(id), ...t, spend, costPerDeal: t.deals && spend != null ? spend / t.deals : null };
  };
  const list = [...groups]
    .map(([id, rs]) => entry(id, rs, id == null ? null : spendById.get(id) ?? null))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.deals - a.deals || b.total - a.total);
  return { rows: list, total: { ...entry(null, rows, totalSpend), name: "Total" } };
}
