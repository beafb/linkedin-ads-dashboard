import test from "node:test";
import assert from "node:assert/strict";
import * as I from "../site/insights.js";

const f = { num: (v) => String(Math.round(v)), money: (v) => `€${v.toFixed(2)}` };
const t = (o = {}) => ({ impressions: 0, clicks: 0, landingPageClicks: 0, spend: 0, leadFormOpens: 0, leads: 0,
  engagements: 0, ...o });
const r = (date, adId, o = {}) => ({ date, adId, campaignId: 1, ...t(o) });


test("story: full sentence with comparison", () => {
  const cur = t({ impressions: 150574, clicks: 3036, leads: 354, spend: 6035.7 });
  const prev = t({ impressions: 1, leads: 350, spend: 5145 });
  assert.equal(I.story("30d", cur, { cur, prev }, f),
    "In the last 30 days, your ads were seen 150574 times, 3036 people clicked and 354 became leads, at €17.05 each (16% more than the period before).");
});

test("story: cheaper, same, no previous", () => {
  const cur = t({ impressions: 100, clicks: 5, leads: 10, spend: 90 });
  assert.match(I.story("7d", cur, { cur, prev: t({ impressions: 1, leads: 10, spend: 100 }) }, f), /\(10% less than the period before\)\.$/);
  assert.match(I.story("7d", cur, { cur, prev: t({ impressions: 1, leads: 10, spend: 90 }) }, f), /\(the same as the period before\)\.$/);
  assert.match(I.story("7d", cur, { cur, prev: t() }, f), /at €9\.00 each\.$/);
  assert.match(I.story("month", cur, null, f), /at €9\.00 each\.$/);
});

test("story compares complete days, not today's partial day", () => {
  const cur = t({ impressions: 100, clicks: 5, leads: 2, spend: 100 });          // includes today
  const cmp = { cur: t({ impressions: 90, leads: 1, spend: 40 }), prev: t({ impressions: 90, leads: 1, spend: 50 }) };
  assert.match(I.story("30d", cur, cmp, f), /at €50\.00 each \(20% less than the period before\)\.$/);
});

test("story: singulars and no leads", () => {
  assert.equal(I.story("7d", t({ impressions: 50, clicks: 1, leads: 0 }), null, f),
    "In the last 7 days, your ads were seen 50 times, 1 person clicked and 0 became leads.");
  assert.match(I.story("7d", t({ impressions: 50, clicks: 2, leads: 1, spend: 5 }), null, f), /1 became a lead, at €5\.00 each\.$/);
  assert.match(I.story("7d", t({ impressions: 1 }), null, f), /were seen 1 time,/);
});

test("story: period phrases", () => {
  const cur = t({ impressions: 1 });
  for (const [preset, phrase] of [["month", "This month"], ["lastmonth", "Last month"], ["ytd", "This year"], ["all", "Since the start"]]) {
    assert.ok(I.story(preset, cur, null, f).startsWith(`${phrase}, your ads were seen`), preset);
  }
});

test("story: no activity", () => {
  assert.equal(I.story("30d", t(), { cur: t(), prev: t({ impressions: 5 }) }, f), "No ads ran in this period.");
});

test("verdict rules and boundaries", () => {
  assert.equal(I.verdict(t({ impressions: 999, leads: 5, spend: 10 }), 10), "early");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 0, spend: 50 }), 10), "noLeads");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 8 }), null), "solid");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 8 }), 10), "star");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 8.01 }), 10), "solid");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 15 }), 10), "costly");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 14.99 }), 10), "solid");
  // exact boundaries with non-round averages (floating point)
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 0.6 }), 10 / 25), "costly");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 0.56 }), 7 / 10), "star");
  for (const k of ["early", "noLeads", "star", "costly", "solid"]) {
    assert.ok(I.VERDICTS[k].icon && I.VERDICTS[k].label && I.VERDICTS[k].help, k);
  }
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

test("byLeads and medals", () => {
  const list = [{ id: 1, leads: 5, cpl: 10 }, { id: 2, leads: 5, cpl: 8 }, { id: 3, leads: 0, cpl: null },
                { id: 4, leads: 9, cpl: 20 }, { id: 5, leads: 1, cpl: 3 }];
  assert.deepEqual(I.byLeads(list).map(a => a.id), [4, 2, 1, 5, 3]);
  assert.deepEqual([...I.medals(list)], [[4, "🥇"], [2, "🥈"], [1, "🥉"]]);
  assert.deepEqual([...I.medals([{ id: 3, leads: 0, cpl: null }, { id: 7, leads: 2, cpl: 1 }])], [[7, "🥇"]]);
});

test("bestDay picks most leads, latest on ties, null without leads", () => {
  const days = [{ date: "2026-09-01", leads: 3 }, { date: "2026-09-02", leads: 5 }, { date: "2026-09-03", leads: 5 }];
  assert.equal(I.bestDay(days).date, "2026-09-03");
  assert.equal(I.bestDay([{ date: "2026-09-01", leads: 0 }]), null);
});

test("per1000", () => {
  assert.deepEqual(I.per1000(t({ impressions: 2000, clicks: 40, leadFormOpens: 36, leads: 5 })), { clicks: 20, formOpens: 18, leads: 2.5 });
  assert.equal(I.per1000(t()), null);
});

test("trend sentence", () => {
  const p = (o) => t({ impressions: 1000, ...o });
  assert.equal(I.trend({ cur: p({ leads: 104, spend: 1160 }), prev: p({ leads: 100, spend: 1000 }) }), "Leads rose 4%, cost per lead rose 12%.");
  assert.equal(I.trend({ cur: p({ leads: 50, spend: 400 }), prev: p({ leads: 100, spend: 1000 }) }), "Leads fell 50%, cost per lead fell 20%.");
  assert.equal(I.trend({ cur: p({ leads: 100, spend: 1000 }), prev: p({ leads: 100, spend: 1000 }) }), "Leads stayed the same, cost per lead stayed the same.");
  assert.equal(I.trend({ cur: p({ leads: 0 }), prev: p({ leads: 10, spend: 50 }) }), "Leads fell 100%.");
  assert.equal(I.trend({ cur: p({ leads: 3, spend: 30 }), prev: p({ leads: 0, spend: 20 }) }), "Leads went from 0 to 3.");
  assert.equal(I.trend({ cur: p({ leads: 0 }), prev: p({ leads: 0 }) }), "No leads in either period.");
  assert.equal(I.trend({ cur: p({ leads: 5 }), prev: t() }), "Not enough history to compare yet.");
  assert.equal(I.trend(null), "Not enough history to compare yet.");
});

test("count pluralises", () => {
  assert.equal(I.count(1, "lead", f.num), "1 lead");
  assert.equal(I.count(0, "lead", f.num), "0 leads");
  assert.equal(I.count(240, "lead", f.num), "240 leads");
});
