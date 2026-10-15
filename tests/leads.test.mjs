import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../site/leads.js";

const r = (date, accountId, campaignId, adId, status, count = 1, unsubscribed = 0) =>
  ({ date, accountId, campaignId, adId, status, count, unsubscribed });
const rows = [
  r("2026-09-29", 1, 10, 100, "Not in Brevo", 2),
  r("2026-09-29", 1, 10, 100, "In Brevo, no deal", 5, 1),
  r("2026-09-30", 1, 10, 101, "Warm", 2),
  r("2026-10-01", 1, 20, 200, "Hot", 1),
  r("2026-10-01", 2, 30, 300, "Won", 1),
  r("2026-10-01", 2, null, null, "In Brevo, no deal", 3),
  r("2026-10-06", 2, 30, 300, "Lost", 1),
];
const f = { num: (v) => String(v) };

test("filterLeadRows by period, accounts and campaign", () => {
  const range = { start: "2026-09-29", end: "2026-10-01" };
  assert.equal(L.filterLeadRows(rows, range, new Set([1, 2]), null).length, 6);
  assert.equal(L.filterLeadRows(rows, range, new Set([1, 2]), 10).length, 3);
  assert.equal(L.filterLeadRows(rows, range, new Set([2]), null).length, 2);
});

test("statusTotals", () => {
  const t = L.statusTotals(rows);
  assert.equal(t.total, 15);
  assert.equal(t.byStatus["Not in Brevo"], 2);
  assert.equal(t.byStatus["In Brevo, no deal"], 8);
  assert.equal(t.inBrevo, 13);
  assert.equal(t.deals, 5);
  assert.equal(t.hot, 1);
  assert.equal(t.won, 1);
  assert.equal(t.unsubscribed, 1);
  assert.equal(L.statusTotals([]).total, 0);
});

test("funnel values and step rates", () => {
  const steps = L.funnel(L.statusTotals(rows));
  assert.deepEqual(steps.map((s) => s.value), [15, 13, 5, 1, 1]);
  assert.deepEqual(steps.map((s) => s.rate), [null, 13 / 15, 5 / 13, 1 / 5, 1 / 5]);  // Hot and Won as a share of deals
  assert.deepEqual(steps.map((s) => s.of), [null, "previous step", "previous step", "deals", "deals"]);
  assert.deepEqual(L.funnel(L.statusTotals([])).map((s) => s.rate), [null, null, null, null, null]);
});

test("fullFunnel: ads steps, then Brevo steps when there is lead data", () => {
  const ad = { impressions: 1000, clicks: 50, leads: 16 };
  const steps = L.fullFunnel(ad, L.statusTotals(rows));
  assert.deepEqual(steps.map((s) => s.key), ["impressions", "clicks", "leads", "inBrevo", "deals", "won"]);
  assert.deepEqual(steps.map((s) => s.value), [1000, 50, 16, 13, 5, 1]);
  assert.deepEqual(steps.map((s) => s.rate), [null, 0.05, 16 / 50, 13 / 15, 5 / 13, 1 / 5]);  // In Brevo vs form leads
  assert.deepEqual(L.fullFunnel(ad, L.statusTotals([])).map((s) => s.key), ["impressions", "clicks", "leads"]);
  assert.equal(L.fullFunnel({ impressions: 0, clicks: 0, leads: 0 }, L.statusTotals([]))[1].rate, null);
});

test("followUpSeries folds deal stages into Deal, per week or per day", () => {
  const w = L.followUpSeries(rows, { start: "2026-09-29", end: "2026-10-06" }, "week");
  assert.deepEqual(w.days, ["2026-09-28", "2026-10-05"]);
  assert.deepEqual(w.series.get("Not in Brevo"), [2, 0]);
  assert.deepEqual(w.series.get("In Brevo, no deal"), [8, 0]);
  assert.deepEqual(w.series.get("Deal"), [4, 1]);
  assert.deepEqual([...w.series.keys()], L.FOLLOW_UP);
  const d = L.followUpSeries(rows, { start: "2026-09-30", end: "2026-10-01" }, "day");
  assert.deepEqual(d.days, ["2026-09-30", "2026-10-01"]);
  assert.deepEqual(d.series.get("Deal"), [2, 2]);
  assert.deepEqual(d.series.get("In Brevo, no deal"), [0, 3]);
});

test("pipeline lists non-empty stages in order", () => {
  assert.equal(L.pipeline(L.statusTotals(rows).byStatus), "2 warm · 1 hot · 1 won · 1 lost");
  assert.equal(L.pipeline(L.statusTotals([]).byStatus), "");
});

test("dealsBy counts deal stages only", () => {
  assert.deepEqual([...L.dealsBy(rows, "adId")], [[101, 2], [200, 1], [300, 2]]);
});

test("leadTable by campaign: sorted by deals then leads, cost per deal, unknown campaign", () => {
  const nameOf = (id) => (id == null ? "Unknown campaign" : `C${id}`);
  const t = L.leadTable(rows, "campaign", nameOf, new Map([[10, 100], [20, 50], [30, 30]]), 180);
  assert.deepEqual(t.rows.map((e) => [e.name, e.total, e.deals, e.costPerDeal]),
    [["C10", 9, 2, 50], ["C30", 2, 2, 15], ["C20", 1, 1, 50], ["Unknown campaign", 3, 0, null]]);
  assert.equal(t.rows[0].unsubscribed, 1);
  assert.equal(t.total.name, "Total");
  assert.equal(t.total.total, 15);
  assert.equal(t.total.costPerDeal, 36);
});

test("leadTable by ad", () => {
  const t = L.leadTable(rows, "ad", (id) => `A${id}`, new Map(), 0);
  assert.deepEqual(t.rows.map((e) => e.name), ["A101", "A300", "A200", "A100", "Anull"]);  // ties keep first-seen order
  assert.equal(t.rows[0].costPerDeal, null);
});
