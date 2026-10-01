import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../site/sheet.js";

const r = (date, adId, campaignId, o = {}) => ({ date, adId, campaignId, impressions: 0, clicks: 0, landingPageClicks: 0,
  spend: 0, leadFormOpens: 0, leads: 0, engagements: 0, ...o });
const range = { start: "2026-09-29", end: "2026-10-01" };
const rows = [
  r("2026-09-30", 1, 10, { impressions: 100, clicks: 10, leads: 2, spend: 20 }),
  r("2026-09-30", 2, 20, { impressions: 50, clicks: 5, leads: 0, spend: 5 }),
  r("2026-10-01", 1, 10, { impressions: 0 }),
  r("2026-10-01", 3, null, { impressions: 10, clicks: 1, leads: 1, spend: 4 }),
];
const names = { 10: "Camp A", 20: "Camp B", 1: "Ad one", 2: "Ad, \"two\"", 3: "Ad three" };
const nameOf = (id) => (id == null ? "Unknown campaign" : names[id]);

test("total level zero-fills days, newest first, with totals", () => {
  const { rows: out, total } = S.sheetRows(rows, range, "total", nameOf);
  assert.deepEqual(out.map(x => [x.date, x.impressions, x.label]),
    [["2026-10-01", 10, null], ["2026-09-30", 150, null], ["2026-09-29", 0, null]]);
  assert.equal(total.impressions, 160);
  assert.equal(total.leads, 3);
  assert.equal(total.cpl, 29 / 3);
  assert.equal(out[2].ctr, null);
});

test("campaign level groups by day and campaign, skips zero impressions, names null campaign", () => {
  const { rows: out } = S.sheetRows(rows, range, "campaign", nameOf);
  assert.deepEqual(out.map(x => [x.date, x.label, x.impressions]),
    [["2026-10-01", "Unknown campaign", 10], ["2026-09-30", "Camp A", 100], ["2026-09-30", "Camp B", 50]]);
});

test("ad level uses ad names", () => {
  const { rows: out } = S.sheetRows(rows, range, "ad", nameOf);
  assert.deepEqual(out.map(x => x.label), ["Ad three", "Ad one", "Ad, \"two\""]);
  assert.equal(out[1].cpl, 10);
});

test("shadeStep", () => {
  assert.equal(S.shadeStep(0, 10), 0);
  assert.equal(S.shadeStep(1, 10), 1);
  assert.equal(S.shadeStep(5, 10), 3);
  assert.equal(S.shadeStep(10, 10), 5);
  assert.equal(S.shadeStep(3, 0), 0);
});

test("toCsv escapes commas, quotes and newlines", () => {
  assert.equal(S.toCsv(["a", "b"], [["x,y", "say \"hi\""], ["line\nbreak", null]]),
    "a,b\n\"x,y\",\"say \"\"hi\"\"\"\n\"line\nbreak\",\n");
});

test("sheetCsv: French Excel format uses ; and decimal commas", () => {
  const fr = S.sheetCsv(S.sheetRows(rows, range, "ad", nameOf), "ad", { sep: ";", decimal: "," }).split("\n");
  assert.equal(fr[0], "Date;Ad;Seen by;Clicks;Click rate;Form opens;Leads;Spend;Cost per lead");
  assert.equal(fr[1], "Total;;160;16;0,1;0;3;29;9,67");
  assert.equal(fr[4], "2026-09-30;\"Ad, \"\"two\"\"\";50;5;0,1;0;0;5;");
  assert.equal(S.toCsv(["a"], [["x;y"]], ";"), "a\n\"x;y\"\n");
});

test("sheetCsv: totals first, raw numbers, label column only when grouped", () => {
  const total = S.sheetCsv(S.sheetRows(rows, range, "total", nameOf), "total").split("\n");
  assert.equal(total[0], "Date,Seen by,Clicks,Click rate,Form opens,Leads,Spend,Cost per lead");
  assert.equal(total[1], "Total,160,16,0.1,0,3,29,9.67");
  assert.equal(total[4], "2026-09-29,0,0,,0,0,0,");
  const ad = S.sheetCsv(S.sheetRows(rows, range, "ad", nameOf), "ad").split("\n");
  assert.equal(ad[0], "Date,Ad,Seen by,Clicks,Click rate,Form opens,Leads,Spend,Cost per lead");
  assert.equal(ad[4], "2026-09-30,\"Ad, \"\"two\"\"\",50,5,0.1,0,0,5,");
});
