import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../site/metrics.js";

const row = (date, adId, o = {}) => ({ date, adId, campaignId: 10, impressions: 0, clicks: 0, landingPageClicks: 0,
  spend: 0, leadFormOpens: 0, leads: 0, engagements: 0, ...o });

test("rangeFor presets", () => {
  const t = "2026-10-01";
  assert.deepEqual(M.rangeFor("7d", t), { start: "2026-09-25", end: t });
  assert.deepEqual(M.rangeFor("30d", t), { start: "2026-09-02", end: t });
  assert.deepEqual(M.rangeFor("month", t), { start: "2026-10-01", end: t });
  assert.deepEqual(M.rangeFor("lastmonth", t), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(M.rangeFor("lastmonth", "2026-01-15"), { start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(M.rangeFor("ytd", t), { start: "2026-01-01", end: t });
  assert.deepEqual(M.rangeFor("all", t, "2026-04-06"), { start: "2026-04-06", end: t });
  assert.throws(() => M.rangeFor("bogus", t));
});

test("previousRange has equal length and ends the day before", () => {
  assert.deepEqual(M.previousRange({ start: "2026-09-25", end: "2026-10-01" }), { start: "2026-09-18", end: "2026-09-24" });
  assert.deepEqual(M.previousRange({ start: "2026-03-01", end: "2026-03-31" }), { start: "2026-01-29", end: "2026-02-28" });
});

test("filterRows by date and ad", () => {
  const rows = [row("2026-09-30", 1), row("2026-10-01", 1), row("2026-10-01", 2), row("2026-10-02", 1)];
  const got = M.filterRows(rows, { start: "2026-09-30", end: "2026-10-01" }, new Set([1]));
  assert.deepEqual(got.map(r => r.date), ["2026-09-30", "2026-10-01"]);
});

test("totals and ratios", () => {
  const t = M.totals([row("2026-10-01", 1, { impressions: 1000, clicks: 40, spend: 50, leadFormOpens: 10, leads: 5 }),
                      row("2026-10-01", 2, { impressions: 1000, clicks: 40, spend: 50.5, leadFormOpens: 10, leads: 5 })]);
  assert.equal(t.impressions, 2000);
  assert.equal(t.spend, 100.5);
  const r = M.ratios(t);
  assert.equal(r.cpl, 10.05);
  assert.equal(r.ctr, 0.04);
  assert.equal(r.cpc, 1.25625);
  assert.ok(Math.abs(r.cpm - 50.25) < 1e-9);
  assert.equal(r.formRate, 0.5);
  assert.equal(r.clickToForm, 0.25);
});

test("empty period gives zeros and null ratios, never NaN/Infinity", () => {
  const t = M.totals([]);
  assert.equal(t.leads, 0);
  assert.equal(t.spend, 0);
  for (const v of Object.values(M.ratios(t))) assert.equal(v, null);
});

test("delta", () => {
  assert.equal(M.delta(150, 100), 0.5);
  assert.equal(M.delta(50, 100), -0.5);
  assert.equal(M.delta(10, 0), null);
  assert.equal(M.delta(null, 5), null);
  assert.equal(M.delta(5, null), null);
});

test("byDate fills missing days with zeros", () => {
  const got = M.byDate([row("2026-09-30", 1, { leads: 2 }), row("2026-09-30", 2, { leads: 1 })],
                       { start: "2026-09-29", end: "2026-10-01" });
  assert.deepEqual(got.map(d => [d.date, d.leads]), [["2026-09-29", 0], ["2026-09-30", 3], ["2026-10-01", 0]]);
});

test("groupTotals groups by any key", () => {
  const rows = [row("2026-09-30", 1, { spend: 1, campaignId: 10 }), row("2026-10-01", 1, { spend: 2, campaignId: 10 }),
                row("2026-10-01", 2, { spend: 5, campaignId: 20 })];
  assert.equal(M.groupTotals(rows, "adId").get(1).spend, 3);
  assert.equal(M.groupTotals(rows, "campaignId").get(20).spend, 5);
});

test("compareRanges compares complete days only", () => {
  assert.deepEqual(M.compareRanges({ start: "2026-09-02", end: "2026-10-01" }, "2026-10-01"),
    { current: { start: "2026-09-02", end: "2026-09-30" }, previous: { start: "2026-08-04", end: "2026-09-01" } });
  assert.deepEqual(M.compareRanges({ start: "2026-09-01", end: "2026-09-30" }, "2026-10-01"),
    { current: { start: "2026-09-01", end: "2026-09-30" }, previous: { start: "2026-08-02", end: "2026-08-31" } });
  assert.equal(M.compareRanges({ start: "2026-10-01", end: "2026-10-01" }, "2026-10-01"), null);
});

test("daysInclusive", () => {
  assert.equal(M.daysInclusive("2026-10-01", "2026-10-01"), 1);
  assert.equal(M.daysInclusive("2026-09-02", "2026-10-01"), 30);
});

test("todayIso is YYYY-MM-DD", () => {
  assert.match(M.todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test("todayIso uses the UTC day, like LinkedIn reporting", () => {
  assert.equal(M.todayIso(new Date("2026-10-01T23:30:00Z")), "2026-10-01");
  assert.equal(M.todayIso(new Date("2026-10-02T00:30:00Z")), "2026-10-02");
});

test("byDateSplit: daily values per key, zero-filled, ignores unknown keys", () => {
  const rows = [row("2026-09-30", 1, { spend: 10.1 }), row("2026-09-30", 2, { spend: 5 }), row("2026-09-30", 1, { spend: 0.2 }),
                row("2026-10-01", 2, { spend: 3 }), row("2026-10-01", 9, { spend: 99 })];
  const accountOf = new Map([[1, "A"], [2, "B"]]);
  const got = M.byDateSplit(rows, { start: "2026-09-29", end: "2026-10-01" }, (r) => accountOf.get(r.adId), ["A", "B"], "spend");
  assert.deepEqual(got.days, ["2026-09-29", "2026-09-30", "2026-10-01"]);
  assert.deepEqual(got.series.get("A"), [0, 10.3, 0]);
  assert.deepEqual(got.series.get("B"), [0, 5, 3]);
});
