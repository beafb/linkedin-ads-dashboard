// Daily sheet: rows per day (optionally per campaign/ad), totals, leads shading and CSV export. Pure.
import { byDate, totals, ratios } from "./metrics.js";

const withRatios = (r) => ({ ...r, ...ratios(r) });

export function sheetRows(rows, range, level, nameOf) {
  let out;
  if (level === "total") {
    out = byDate(rows, range).map((d) => ({ ...d, label: null }));
  } else {
    const key = level === "campaign" ? "campaignId" : "adId";
    const groups = new Map();
    for (const r of rows) {
      const k = `${r.date}|${r[key]}`;
      if (!groups.has(k)) groups.set(k, { date: r.date, id: r[key], rs: [] });
      groups.get(k).rs.push(r);
    }
    out = [...groups.values()]
      .map((g) => ({ date: g.date, label: nameOf(g.id), ...totals(g.rs) }))
      .filter((x) => x.impressions > 0);
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || (a.label || "").localeCompare(b.label || ""));
  return { rows: out.map(withRatios), total: withRatios(totals(rows)) };
}

export function shadeStep(v, max) {
  if (!(v > 0) || !(max > 0)) return 0;
  return Math.max(1, Math.min(5, Math.ceil((v / max) * 5)));
}

const cell = (v, sep) => {
  if (v == null) return "";
  const s = String(v);
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header, lines, sep = ",") =>
  [header, ...lines].map((l) => l.map((v) => cell(v, sep)).join(sep)).join("\n") + "\n";

const LABEL = { campaign: "Campaign", ad: "Ad" };

// French-locale Excel expects ";" between columns and "," for decimals: pass { sep: ";", decimal: "," }.
export function sheetCsv({ rows, total }, level, { sep = ",", decimal = "." } = {}) {
  const n = (v) => (v == null || decimal === "." ? v : String(v).replace(".", decimal));
  const grouped = level !== "total";
  const head = ["Date", ...(grouped ? [LABEL[level]] : []), "Seen by", "Clicks", "Click rate", "Form opens",
    "Leads", "Spend", "Cost per lead"];
  const line = (r, date) => [date, ...(grouped ? [r.label] : []), r.impressions, r.clicks,
    n(r.ctr == null ? null : +r.ctr.toFixed(4)), r.leadFormOpens, r.leads, n(r.spend),
    n(r.cpl == null ? null : +r.cpl.toFixed(2))];
  return toCsv(head, [line({ ...total, label: "" }, "Total"), ...rows.map((r) => line(r, r.date))], sep);
}
