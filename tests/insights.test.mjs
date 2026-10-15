import test from "node:test";
import assert from "node:assert/strict";
import * as I from "../site/insights.js";

const f = { num: (v) => String(Math.round(v)), money: (v) => `€${v.toFixed(2)}` };
const t = (o = {}) => ({ impressions: 0, clicks: 0, landingPageClicks: 0, spend: 0, leadFormOpens: 0, leads: 0,
  engagements: 0, ...o });
const r = (date, adId, o = {}) => ({ date, adId, campaignId: 1, ...t(o) });


test("verdict: deals first, then cost per lead", () => {
  const a = (o) => ({ impressions: 1000, leads: 0, spend: 0, deals: 0, ...o });
  const avg = { cpl: 10, costPerDeal: 100 };
  assert.equal(I.verdict(a({ impressions: 999, leads: 5, spend: 10, deals: 1 }), avg), "early");
  assert.equal(I.verdict(a({ spend: 50 }), avg), "noLeads");
  assert.equal(I.verdict(a({ leads: 10, spend: 100, deals: 1 }), avg), "dealMaker");   // exactly average
  assert.equal(I.verdict(a({ leads: 10, spend: 101, deals: 1 }), avg), "deals");
  assert.equal(I.verdict(a({ leads: 10, spend: 150, deals: 2 }), avg), "dealMaker");   // costly leads, cheap deals
  assert.equal(I.verdict(a({ leads: 1, spend: 5, deals: 1 }), { cpl: 10, costPerDeal: null }), "dealMaker");
  // cheap leads without deals are no longer a "star"
  assert.equal(I.verdict(a({ leads: 1, spend: 8 }), avg), "cheapNoDeal");
  assert.equal(I.verdict(a({ leads: 1, spend: 8.01 }), avg), "solid");
  assert.equal(I.verdict(a({ leads: 1, spend: 15 }), avg), "costly");
  assert.equal(I.verdict(a({ leads: 1, spend: 14.99 }), avg), "solid");
  assert.equal(I.verdict(a({ leads: 1, spend: 8 }), { cpl: null, costPerDeal: null }), "solid");
  // exact boundaries with non-round averages (floating point)
  assert.equal(I.verdict(a({ leads: 1, spend: 0.6 }), { cpl: 10 / 25 }), "costly");
  assert.equal(I.verdict(a({ leads: 1, spend: 0.56 }), { cpl: 7 / 10 }), "cheapNoDeal");
  for (const [k, v] of Object.entries(I.VERDICTS)) assert.ok(v.label && v.help && ["good", "bad", "warn", "neutral"].includes(v.tone), k);
});

test("adList aggregates per ad with ratios", () => {
  const list = I.adList([r("2026-10-01", 1, { impressions: 100, clicks: 10, leads: 2, spend: 20 }),
                         r("2026-10-02", 1, { impressions: 100, clicks: 10, leads: 2, spend: 20 }),
                         r("2026-10-01", 2, { impressions: 50 })]);
  const a1 = list.find(a => a.id === 1);
  assert.equal(a1.leads, 4);
  assert.equal(a1.cpl, 10);
  assert.equal(a1.ctr, 0.1);
  assert.equal(list.find(a => a.id === 2).cpl, null);
});

test("byLeads", () => {
  const list = [{ id: 1, leads: 5, cpl: 10 }, { id: 2, leads: 5, cpl: 8 }, { id: 3, leads: 0, cpl: null },
                { id: 4, leads: 9, cpl: 20 }, { id: 5, leads: 1, cpl: 3 }];
  assert.deepEqual(I.byLeads(list).map(a => a.id), [4, 2, 1, 5, 3]);
});

test("sortBy: both directions, strings, missing values last", () => {
  const list = [{ id: 1, leads: 5, cpl: 10, name: "b" }, { id: 2, leads: 0, cpl: null, name: "a" },
                { id: 3, leads: 2, cpl: 4, name: "c" }, { id: 4, leads: 7, cpl: 10, name: "a" }];
  assert.deepEqual(I.sortBy(list, "cpl", "asc").map(a => a.id), [3, 4, 1, 2]);   // ties: more leads first
  assert.deepEqual(I.sortBy(list, "cpl", "desc").map(a => a.id), [4, 1, 3, 2]);
  assert.deepEqual(I.sortBy(list, "name", "asc").map(a => a.id), [4, 2, 1, 3]);
  assert.deepEqual(I.sortBy(list, "leads", "desc").map(a => a.id), [4, 1, 3, 2]);
});

test("count pluralises", () => {
  assert.equal(I.count(1, "lead", f.num), "1 lead");
  assert.equal(I.count(0, "lead", f.num), "0 leads");
  assert.equal(I.count(240, "lead", f.num), "240 leads");
});
