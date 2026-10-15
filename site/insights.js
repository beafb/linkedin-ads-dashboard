// Plain-English insights: ad verdicts, rankings, sorting. Pure, tested with node --test.
import { ratios, groupTotals } from "./metrics.js";

export const count = (n, word, fmt) => `${fmt(n)} ${n === 1 ? word : `${word}s`}`;

// `tone` picks the badge colour; ads that no longer run always get a neutral badge (see ads.js).
export const VERDICTS = {
  early: { label: "Too early", tone: "neutral", help: "Fewer than 1,000 impressions so far, not enough to judge." },
  noLeads: { label: "No leads", tone: "warn", help: "People see this ad, but nobody has sent the form yet." },
  dealMaker: { label: "Brings deals", tone: "good", help: "Its leads became deals, at a cost per deal at or below your average." },
  deals: { label: "Some deals", tone: "neutral", help: "Its leads became deals, but each deal costs more than your average." },
  cheapNoDeal: { label: "Cheap, no deals", tone: "neutral", help: "Leads cost at least 20% less than average, but none has become a deal yet." },
  costly: { label: "Costly leads", tone: "bad", help: "Leads cost at least 50% more than average, and none has become a deal." },
  solid: { label: "Average", tone: "neutral", help: "Cost per lead is close to your average and no deal yet." },
};

// Deals come first: cheap leads that never turn into deals are not a win.
// `a` = ad totals with `deals`; avg = { cpl, costPerDeal } for the whole selection.
export function verdict(a, avg) {
  if (a.impressions < 1000) return "early";
  if (!a.leads) return "noLeads";
  const EPS = 1e-9;  // exact boundaries must not fall through on floating-point noise
  if (a.deals > 0) {
    const cpd = a.spend / a.deals;
    return avg.costPerDeal == null || cpd <= avg.costPerDeal * (1 + EPS) ? "dealMaker" : "deals";
  }
  if (avg.cpl == null) return "solid";
  const cpl = a.spend / a.leads;
  if (cpl <= 0.8 * avg.cpl * (1 + EPS)) return "cheapNoDeal";
  if (cpl >= 1.5 * avg.cpl * (1 - EPS)) return "costly";
  return "solid";
}

export function adList(rows) {
  return [...groupTotals(rows, "adId")].map(([id, t]) => ({ id, ...t, ...ratios(t) }));
}

export function byLeads(list) {
  return [...list].sort((a, b) => b.leads - a.leads || (a.cpl ?? Infinity) - (b.cpl ?? Infinity));
}

// Table sort: missing values (no leads → no CPL) always sink to the bottom, whatever the direction.
export function sortBy(list, key, dir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return c * sign || b.leads - a.leads;
  });
}
