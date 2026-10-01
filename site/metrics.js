// Pure aggregation helpers for the dashboard. No DOM access, tested with `node --test tests/*.test.mjs`.
// Dates are "YYYY-MM-DD" strings in the ad account's reporting day.

export const SUM_KEYS = ["impressions", "clicks", "landingPageClicks", "spend", "leadFormOpens", "leads", "engagements"];

const DAY_MS = 86400000;
export const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * DAY_MS));
export const daysInclusive = (start, end) => Math.round((toDate(end) - toDate(start)) / DAY_MS) + 1;
export const todayIso = (now = new Date()) => toIso(now);  // UTC day: LinkedIn reports in UTC

export function rangeFor(preset, today, firstDate) {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "7d": return { start: addDays(today, -6), end: today };
    case "30d": return { start: addDays(today, -29), end: today };
    case "month": return { start: monthStart, end: today };
    case "lastmonth": {
      const end = addDays(monthStart, -1);
      return { start: `${end.slice(0, 7)}-01`, end };
    }
    case "ytd": return { start: `${today.slice(0, 4)}-01-01`, end: today };
    case "all": return { start: firstDate || today, end: today };
    default: throw new Error(`Unknown range preset: ${preset}`);
  }
}

export function previousRange({ start, end }) {
  const n = daysInclusive(start, end);
  return { start: addDays(start, -n), end: addDays(start, -1) };
}

// Comparisons use complete days only: today's partial day would make every period look worse.
export function compareRanges(range, today) {
  const end = range.end >= today ? addDays(today, -1) : range.end;
  if (end < range.start) return null;
  const current = { start: range.start, end };
  return { current, previous: previousRange(current) };
}

export function filterRows(daily, { start, end }, adIds) {
  return daily.filter((r) => r.date >= start && r.date <= end && adIds.has(r.adId));
}

export function totals(rows) {
  const t = Object.fromEntries(SUM_KEYS.map((k) => [k, 0]));
  for (const r of rows) for (const k of SUM_KEYS) t[k] += r[k] || 0;
  t.spend = Math.round(t.spend * 100) / 100;
  return t;
}

const div = (a, b) => (b ? a / b : null);

export function ratios(t) {
  return {
    cpl: div(t.spend, t.leads),
    ctr: div(t.clicks, t.impressions),
    cpc: div(t.spend, t.clicks),
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : null,
    formRate: div(t.leads, t.leadFormOpens),
    clickToForm: div(t.leadFormOpens, t.clicks),
  };
}

export function delta(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / prev;
}

export function byDate(rows, { start, end }) {
  const days = new Map();
  for (let d = start; d <= end; d = addDays(d, 1)) days.set(d, []);
  for (const r of rows) days.get(r.date)?.push(r);
  return [...days].map(([date, rs]) => ({ date, ...totals(rs) }));
}

export function groupTotals(rows, key) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r[key])) groups.set(r[key], []);
    groups.get(r[key]).push(r);
  }
  return new Map([...groups].map(([id, rs]) => [id, totals(rs)]));
}

// One daily series per key (e.g. per account) for stacked charts; days with nothing are 0.
export function byDateSplit(rows, { start, end }, keyOf, keys, field) {
  const days = [];
  const index = new Map();
  for (let d = start; d <= end; d = addDays(d, 1)) { index.set(d, days.length); days.push(d); }
  const series = new Map(keys.map((k) => [k, days.map(() => 0)]));
  for (const r of rows) {
    const i = index.get(r.date), s = series.get(keyOf(r));
    if (i != null && s) s[i] += r[field] || 0;
  }
  for (const s of series.values()) s.forEach((v, i) => { s[i] = Math.round(v * 100) / 100; });
  return { days, series };
}
