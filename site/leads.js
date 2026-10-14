// Lead status (LinkedIn forms joined with Brevo): filters, totals, funnel, sentence, weekly series, table. Pure.
import { addDays, toDate } from "./metrics.js";

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

export function dealSentence(t, f) {
  if (!t.total) return "";
  if (!t.deals) return "None of them has become a deal in your CRM yet.";
  const head = `So far, ${f.num(t.deals)} of them ${t.deals === 1 ? "became a deal" : "became deals"} in your CRM`;
  const parts = [];
  if (t.hot) parts.push(`${f.num(t.hot)} ${t.hot === 1 ? "is" : "are"} Hot`);
  if (t.won) parts.push(`${f.num(t.won)} ${t.won === 1 ? "was" : "were"} won`);
  if (!parts.length) return `${head}.`;
  return parts.length === 1 ? `${head}, and ${parts[0]}.` : `${head}, ${parts.join(" and ")}.`;
}

export const weekStart = (iso) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));

export function weeklyStatus(rows, { start, end }) {
  const weeks = [];
  for (let w = weekStart(start); w <= end; w = addDays(w, 7)) weeks.push(w);
  const index = new Map(weeks.map((w, i) => [w, i]));
  const series = new Map(STATUSES.map((s) => [s, weeks.map(() => 0)]));
  for (const r of rows) {
    const i = index.get(weekStart(r.date));
    if (i != null && series.has(r.status)) series.get(r.status)[i] += r.count;
  }
  return { weeks, series };
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
