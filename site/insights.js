// Plain-English insights: story sentence, ad verdicts, rankings, highlights. Pure, tested with node --test.
import { ratios, delta, groupTotals } from "./metrics.js";

export const PERIOD_PHRASE = {
  "7d": "In the last 7 days", "30d": "In the last 30 days", month: "This month",
  lastmonth: "Last month", ytd: "This year", all: "Since the start",
};

export const previousPhrase = (days) => (days === 1 ? "the day before" : `the previous ${days} days`);

const pctRound = (d) => Math.round(d * 100);

export function story(preset, cur, prev, days, f) {
  if (!cur.impressions) return "No ads ran in this period.";
  const people = cur.clicks === 1 ? "person" : "people";
  const leads = cur.leads === 1 ? "1 became a lead" : `${f.num(cur.leads)} became leads`;
  let s = `${PERIOD_PHRASE[preset]}, your ads were seen ${f.num(cur.impressions)} times, ` +
    `${f.num(cur.clicks)} ${people} clicked and ${leads}`;
  const cpl = ratios(cur).cpl;
  if (cpl == null) return `${s}.`;
  s += `, at ${f.money(cpl)} each`;
  const d = delta(cpl, ratios(prev).cpl);
  if (d == null) return `${s}.`;
  const p = pctRound(d);
  const cmp = p === 0 ? `the same as ${previousPhrase(days)}`
    : `${Math.abs(p)}% ${p > 0 ? "more" : "less"} than ${previousPhrase(days)}`;
  return `${s} (${cmp}).`;
}

export const VERDICTS = {
  early: { icon: "⏳", label: "Too early to tell", help: "Fewer than 1,000 views so far, not enough to judge." },
  noLeads: { icon: "👀", label: "Seen but not converting", help: "People see this ad, but nobody has sent the form yet." },
  star: { icon: "⭐", label: "Star performer", help: "Each lead costs at least 20% less than your average." },
  costly: { icon: "⚠️", label: "Costly leads", help: "Each lead costs at least 50% more than your average." },
  solid: { icon: "✅", label: "Solid", help: "Cost per lead is close to your average." },
};

export function verdict(t, avgCpl) {
  if (t.impressions < 1000) return "early";
  if (!t.leads) return "noLeads";
  if (avgCpl == null) return "solid";
  const cpl = t.spend / t.leads;
  if (cpl <= 0.8 * avgCpl) return "star";
  if (cpl >= 1.5 * avgCpl) return "costly";
  return "solid";
}

export function adList(rows) {
  return [...groupTotals(rows, "adId")].map(([id, t]) => ({ id, ...t, ...ratios(t) }));
}

export function byLeads(list) {
  return [...list].sort((a, b) => b.leads - a.leads || (a.cpl ?? Infinity) - (b.cpl ?? Infinity));
}

export function medals(list) {
  const top = byLeads(list).filter((a) => a.leads > 0).slice(0, 3);
  return new Map(top.map((a, i) => [a.id, ["🥇", "🥈", "🥉"][i]]));
}

export function bestDay(days) {
  let best = null;
  for (const d of days) if (d.leads > 0 && (!best || d.leads >= best.leads)) best = d;
  return best;
}

export function per1000(t) {
  if (!t.impressions) return null;
  const k = 1000 / t.impressions;
  return { clicks: t.clicks * k, formOpens: t.leadFormOpens * k, leads: t.leads * k };
}

const change = (d, noun) => {
  const p = pctRound(d);
  return p === 0 ? `${noun} stayed the same` : `${noun} ${p > 0 ? "rose" : "fell"} ${Math.abs(p)}%`;
};

export function trend(cur, prev) {
  const dl = delta(cur.leads, prev.leads);
  if (dl == null) return "Not enough history to compare yet.";
  const dc = delta(ratios(cur).cpl, ratios(prev).cpl);
  return `${change(dl, "Leads")}${dc == null ? "" : `, ${change(dc, "cost per lead")}`}.`;
}
