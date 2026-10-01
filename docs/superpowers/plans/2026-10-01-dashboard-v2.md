# LinkedIn Ads Dashboard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the live dashboard into a plain-English, three-tab experience (Overview · Ads · Daily sheet) built on per-ad daily data.

**Architecture:** `build_data.py` switches to `pivot=CREATIVE` and adds an `ads` list; `daily` rows carry `adId` + `campaignId`. Pure, unit-tested JS modules (`metrics.js`, `insights.js`, `sheet.js`) compute everything; thin DOM modules (`ui.js`, `overview.js`, `ads.js`, `sheet-view.js`) render it; `app.js` holds state/URL hash and the header.

**Tech Stack:** Python 3 stdlib, vanilla JS ES modules, Chart.js 4.4.1 (cdnjs), `node:test`, GitHub Actions + Pages (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-01-dashboard-v2-design.md` (builds on `2026-10-01-linkedin-ads-dashboard-design.md`)

## Global Constraints

- Python stdlib-only; JS without build step or npm dependencies; Chart.js only from `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`.
- English UI, plain words; glossary texts exactly as in the spec "Glossary" section.
- No dual-axis charts; untrusted strings (campaign/ad names) only via `textContent` / `new Option(text)`.
- Verdict thresholds: < 1,000 impressions → early; 0 leads → noLeads; avg null → solid; cpl ≤ 0.8×avg → star; cpl ≥ 1.5×avg → costly; else solid.
- Ad status strings: Running, Not delivering, Paused, Ended, Draft (else title-cased with spaces).
- URL hash keys: `tab`, `acc`, `range`, `c`, `ad`, `level`.
- Test commands: `python3 -m unittest discover -s tests -t .` and `node --test tests/*.test.mjs`.
- Pushing to `main` deploys publicly — needs explicit user confirmation.

## Review Focus

1. **Ad without a campaign or missing from the creatives list** (deleted ad) must still count in totals and appear as "Ad <id>" with "Unknown campaign", not crash the cards or the sheet. → Task 1 `test_orphan_ad_gets_stub`; Task 4 `sheet campaign level names null campaign`.
2. **Period where nothing ran** must show "No ads ran in this period." in story, ads and sheet — no NaN, no empty grid without explanation. → Task 3 `story: no activity`; Task 5 browser check.
3. **Names containing commas, quotes or accents** must survive the CSV export and open correctly in Excel. → Task 4 `toCsv escapes`; BOM in Task 5 download.
4. **Shared link with filters from another account** (`#acc=C2&c=<3CC campaign>&ad=<3CC ad>`) must silently drop the foreign filters. → Task 5 `selectedAds()` + browser check.
5. **Verdict boundaries** (exactly 0.8× and 1.5× the average) must land on Star / Costly. → Task 3 verdict boundary tests.

---

### Task 1: Per-ad data in `build_data.py`

**Files:**
- Modify: `build_data.py` (full replacement below)
- Modify: `tests/test_build_data.py` (full replacement below)

**Interfaces:**
- Consumes: `linkedin_ads.get/get_all/enc/date_obj/load_env` (unchanged).
- Produces: `site/data.json` with `accounts`, `campaigns` (as v1), `ads: [{id:int, accountId:int, campaignId:int|null, name:str, status:str, createdAt:"YYYY-MM-DD"|null}]`, `daily: [{date, adId:int, campaignId:int|null, impressions, clicks, landingPageClicks, spend, leadFormOpens, leads, engagements}]` sorted by `(date, adId)`. Python: `daily_row(el, ad_campaign)`, `ad_status(intended, serving)`, `ad_entry(cr, account_id)`, `build_account(...) -> (account, campaigns, ads, daily)`.

- [ ] **Step 1: Replace `tests/test_build_data.py`**

```python
import unittest
from datetime import date

import build_data as bd

AD_ID = 1476910094
ELEMENT = {
    "dateRange": {"start": {"year": 2026, "month": 4, "day": 6}, "end": {"year": 2026, "month": 4, "day": 6}},
    "pivotValues": [f"urn:li:sponsoredCreative:{AD_ID}"],
    "costInLocalCurrency": "107.5300000000000335346", "impressions": 13468, "clicks": 242,
    "landingPageClicks": 0, "oneClickLeadFormOpens": 223, "oneClickLeads": 23, "totalEngagements": 1118,
}
ORPHAN = {**ELEMENT, "pivotValues": ["urn:li:sponsoredCreative:999"], "costInLocalCurrency": "1"}
CAMPAIGN = {
    "id": 431685124, "name": "C2-like", "campaignGroup": "urn:li:sponsoredCampaignGroup:7",
    "status": "ACTIVE", "objectiveType": "LEAD_GENERATION",
    "dailyBudget": {"currencyCode": "EUR", "amount": "100"},
    "runSchedule": {"start": 1775433600000},  # 2026-04-06T00:00:00Z
}
CREATIVE = {
    "id": f"urn:li:sponsoredCreative:{AD_ID}", "campaign": "urn:li:sponsoredCampaign:431685124",
    "name": "Ad_1_28Jul2026", "intendedStatus": "ACTIVE", "isServing": True,
    "createdAt": 1785196800000,  # 2026-07-28T00:00:00Z
}


class FakeApi:
    def __init__(self, creatives=None):
        self.calls = []
        self.creatives = [CREATIVE] if creatives is None else creatives

    def get(self, path, query):
        self.calls.append((path, query))
        if path == "/adAccounts/1":
            return {"id": 1, "name": "Acme", "currency": "EUR"}
        if path == "/adAnalytics":  # rows only in the first chunk, like an older campaign
            first = sum(1 for p, _ in self.calls if p == "/adAnalytics") == 1
            return {"elements": [ELEMENT, ORPHAN] if first else []}
        raise AssertionError(path)

    def get_all(self, path, query):
        if path == "/adAccounts/1/adCampaignGroups":
            return [{"id": 7, "name": "Group A"}]
        if path == "/adAccounts/1/adCampaigns":
            return [CAMPAIGN]
        if path == "/adAccounts/1/creatives":
            self.calls.append((path, query))
            return self.creatives
        raise AssertionError(path)


class Mapping(unittest.TestCase):
    def test_daily_row_maps_fields(self):
        self.assertEqual(bd.daily_row(ELEMENT, {AD_ID: 431685124}), {
            "date": "2026-04-06", "adId": AD_ID, "campaignId": 431685124, "impressions": 13468, "clicks": 242,
            "landingPageClicks": 0, "spend": 107.53, "leadFormOpens": 223, "leads": 23, "engagements": 1118})

    def test_daily_row_unknown_ad_has_null_campaign(self):
        self.assertIsNone(bd.daily_row(ORPHAN, {AD_ID: 431685124})["campaignId"])

    def test_daily_row_missing_or_null_metric_is_zero(self):
        el = {k: v for k, v in ELEMENT.items() if k != "oneClickLeads"}
        el["clicks"] = None
        row = bd.daily_row(el, {})
        self.assertEqual((row["leads"], row["clicks"]), (0, 0))

    def test_ad_status(self):
        cases = {("ACTIVE", True): "Running", ("ACTIVE", False): "Not delivering", ("PAUSED", False): "Paused",
                 ("ARCHIVED", False): "Ended", ("CANCELED", False): "Ended", ("COMPLETED", False): "Ended",
                 ("DRAFT", False): "Draft", ("PENDING_DELETION", False): "Pending Deletion", (None, None): ""}
        for args, expected in cases.items():
            self.assertEqual(bd.ad_status(*args), expected, args)

    def test_ad_entry(self):
        self.assertEqual(bd.ad_entry(CREATIVE, 1), {
            "id": AD_ID, "accountId": 1, "campaignId": 431685124, "name": "Ad_1_28Jul2026",
            "status": "Running", "createdAt": "2026-07-28"})

    def test_ad_entry_without_name_date_or_campaign(self):
        ad = bd.ad_entry({"id": "urn:li:sponsoredCreative:5", "intendedStatus": "PAUSED"}, 1)
        self.assertEqual((ad["name"], ad["createdAt"], ad["campaignId"], ad["status"]), ("Ad 5", None, None, "Paused"))

    def test_campaign_entry(self):
        self.assertEqual(bd.campaign_entry(CAMPAIGN, 1, {"urn:li:sponsoredCampaignGroup:7": "Group A"}), {
            "id": 431685124, "accountId": 1, "name": "C2-like", "group": "Group A", "status": "ACTIVE",
            "objective": "LEAD_GENERATION", "dailyBudget": 100.0})

    def test_campaign_entry_without_budget_or_group(self):
        c = bd.campaign_entry({"id": 5, "name": "X"}, 1, {})
        self.assertIsNone(c["dailyBudget"])
        self.assertEqual(c["group"], "")


class Dates(unittest.TestCase):
    def test_earliest_start_uses_min_run_schedule(self):
        later = {**CAMPAIGN, "runSchedule": {"start": 1790000000000}}
        self.assertEqual(bd.earliest_start([later, CAMPAIGN], date(2026, 10, 1)), date(2026, 4, 6))

    def test_earliest_start_without_schedules_is_one_year_back(self):
        self.assertEqual(bd.earliest_start([{"id": 1}], date(2026, 10, 1)), date(2025, 10, 1))

    def test_date_chunks_cover_range_without_gaps(self):
        chunks = bd.date_chunks(date(2026, 1, 1), date(2026, 10, 1), days=90)
        self.assertEqual(chunks[0][0], date(2026, 1, 1))
        self.assertEqual(chunks[-1][1], date(2026, 10, 1))
        for (_, end), (start, _) in zip(chunks, chunks[1:]):
            self.assertEqual((start - end).days, 1)
        self.assertTrue(all((e - s).days < 90 for s, e in chunks))

    def test_date_chunks_single_day(self):
        self.assertEqual(bd.date_chunks(date(2026, 10, 1), date(2026, 10, 1)), [(date(2026, 10, 1), date(2026, 10, 1))])

    def test_expiry_warning(self):
        now = 1_000_000
        self.assertIsNone(bd.expiry_warning(now + 31 * 86400, now))
        self.assertIn("10 days", bd.expiry_warning(now + 10 * 86400, now))
        self.assertIn("0 days", bd.expiry_warning(now - 5, now))


class Build(unittest.TestCase):
    def test_build_account(self):
        api = FakeApi()
        account, campaigns, ads, daily = bd.build_account({"id": 1, "label": "ACME"}, api, date(2026, 10, 1))
        self.assertEqual(account, {"id": 1, "label": "ACME", "name": "Acme", "currency": "EUR"})
        self.assertIn(("/adAccounts/1/creatives", "q=criteria"), api.calls)
        queries = [q for p, q in api.calls if p == "/adAnalytics"]
        self.assertEqual(len(queries), 2)  # 2026-04-06..10-01 = 179 days -> two 90-day chunks
        self.assertIn("dateRange=(start:(year:2026,month:4,day:6),end:(year:2026,month:7,day:4))", queries[0])
        self.assertIn("dateRange=(start:(year:2026,month:7,day:5),end:(year:2026,month:10,day:1))", queries[1])
        for query in queries:
            self.assertIn("pivot=CREATIVE", query)
            self.assertIn("timeGranularity=DAILY", query)
            self.assertIn("accounts=List(urn%3Ali%3AsponsoredAccount%3A1)", query)
            self.assertIn("oneClickLeads", query)
        self.assertEqual([r["campaignId"] for r in daily if r["adId"] == AD_ID], [431685124])

    def test_orphan_ad_gets_stub(self):
        _, _, ads, daily = bd.build_account({"id": 1, "label": "ACME"}, FakeApi(), date(2026, 10, 1))
        self.assertEqual([a for a in ads if a["id"] == 999], [{"id": 999, "accountId": 1, "campaignId": None,
                                                              "name": "Ad 999", "status": "Ended", "createdAt": None}])
        self.assertEqual([r["campaignId"] for r in daily if r["adId"] == 999], [None])

    def test_ad_with_unknown_campaign_gets_campaign_stub(self):
        other = {**CREATIVE, "id": "urn:li:sponsoredCreative:777", "campaign": "urn:li:sponsoredCampaign:555"}
        _, campaigns, _, _ = bd.build_account({"id": 1, "label": "ACME"}, FakeApi([CREATIVE, other]), date(2026, 10, 1))
        self.assertEqual([c for c in campaigns if c["id"] == 555], [{"id": 555, "accountId": 1, "name": "555", "group": "",
                                                                    "status": "UNKNOWN", "objective": "", "dailyBudget": None}])

    def test_build_merges_and_sorts(self):
        out = bd.build([{"id": 1, "label": "ACME"}], FakeApi(), date(2026, 10, 1), "2026-10-01T00:00:00+00:00")
        self.assertEqual(out["generatedAt"], "2026-10-01T00:00:00+00:00")
        self.assertEqual([a["label"] for a in out["accounts"]], ["ACME"])
        self.assertEqual(sorted(a["id"] for a in out["ads"]), [999, AD_ID])
        self.assertEqual([r["adId"] for r in out["daily"]], [999, AD_ID])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest discover -s tests -t .`
Expected: FAIL/ERROR — `daily_row() missing 1 required positional argument`, `no attribute 'ad_status'`, `not enough values to unpack`.

- [ ] **Step 3: Replace `build_data.py`**

```python
#!/usr/bin/env python3
"""Pull every ad account in accounts.json and write site/data.json for the dashboard.

Usage: python3 build_data.py
Auth comes from linkedin_ads.py (.env / .linkedin_tokens.json locally, LKDN_REFRESH_TOKEN in CI).
Daily numbers are per ad (adAnalytics pivot=CREATIVE); campaign and account totals are sums of ad rows.
"""
import json, os, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import linkedin_ads as li

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "site" / "data.json"
# dashboard key -> LinkedIn adAnalytics field
METRIC_MAP = {
    "impressions": "impressions", "clicks": "clicks", "landingPageClicks": "landingPageClicks",
    "spend": "costInLocalCurrency", "leadFormOpens": "oneClickLeadFormOpens",
    "leads": "oneClickLeads", "engagements": "totalEngagements",
}
FIELDS = ["dateRange", "pivotValues"] + list(METRIC_MAP.values())
STATUS_LABELS = {"PAUSED": "Paused", "ARCHIVED": "Ended", "CANCELED": "Ended", "COMPLETED": "Ended", "DRAFT": "Draft"}


def urn_id(urn):
    return int(urn.rsplit(":", 1)[-1])


def ms_to_date(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).date()


def daily_row(el, ad_campaign):
    d = el["dateRange"]["start"]
    ad_id = urn_id(el["pivotValues"][0])
    row = {"date": f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}",
           "adId": ad_id, "campaignId": ad_campaign.get(ad_id)}
    for key, field in METRIC_MAP.items():
        value = el.get(field) or 0
        row[key] = round(float(value), 2) if key == "spend" else int(value)
    return row


def ad_status(intended, serving):
    if intended == "ACTIVE":
        return "Running" if serving else "Not delivering"
    return STATUS_LABELS.get(intended, (intended or "").replace("_", " ").title())


def ad_entry(cr, account_id):
    ad_id = urn_id(cr["id"])
    created = cr.get("createdAt")
    return {"id": ad_id, "accountId": account_id,
            "campaignId": urn_id(cr["campaign"]) if cr.get("campaign") else None,
            "name": cr.get("name") or f"Ad {ad_id}",
            "status": ad_status(cr.get("intendedStatus"), cr.get("isServing")),
            "createdAt": ms_to_date(created).isoformat() if created else None}


def campaign_entry(c, account_id, group_names):
    budget = (c.get("dailyBudget") or {}).get("amount")
    return {"id": c["id"], "accountId": account_id, "name": c.get("name") or str(c["id"]),
            "group": group_names.get(c.get("campaignGroup"), ""), "status": c.get("status", ""),
            "objective": c.get("objectiveType", ""),
            "dailyBudget": float(budget) if budget is not None else None}


def earliest_start(campaigns, today):
    starts = [c["runSchedule"]["start"] for c in campaigns if (c.get("runSchedule") or {}).get("start")]
    if not starts:
        return today - timedelta(days=365)
    return min(ms_to_date(min(starts)), today)


def date_chunks(since, until, days=90):
    """Split [since, until] into consecutive windows of at most `days` days.
    adAnalytics returns at most 15,000 elements per request, without paging or an error."""
    chunks, start = [], since
    while start <= until:
        end = min(start + timedelta(days=days - 1), until)
        chunks.append((start, end))
        start = end + timedelta(days=1)
    return chunks


def expiry_warning(expires_at, now):
    days = (expires_at - now) / 86400
    if days >= 30:
        return None
    return f"LinkedIn refresh token expires in {max(days, 0):.0f} days - redo the yearly login (README)."


def build_account(cfg, api, today):
    aid = cfg["id"]
    acc = api.get(f"/adAccounts/{aid}", "")
    groups = api.get_all(f"/adAccounts/{aid}/adCampaignGroups", "q=search")
    camps = api.get_all(f"/adAccounts/{aid}/adCampaigns", "q=search")
    creatives = api.get_all(f"/adAccounts/{aid}/creatives", "q=criteria")
    elements = []
    for start, end in date_chunks(earliest_start(camps, today), today):
        elements += api.get("/adAnalytics", "&".join([
            "q=analytics", "pivot=CREATIVE", "timeGranularity=DAILY",
            f"dateRange=(start:{li.date_obj(start)},end:{li.date_obj(end)})",
            f"accounts=List({li.enc(f'urn:li:sponsoredAccount:{aid}')})",
            "fields=" + ",".join(FIELDS)])).get("elements", [])

    group_names = {f"urn:li:sponsoredCampaignGroup:{g['id']}": g.get("name", "") for g in groups}
    campaigns = [campaign_entry(c, aid, group_names) for c in camps]
    ads = [ad_entry(cr, aid) for cr in creatives]
    ad_campaign = {a["id"]: a["campaignId"] for a in ads}
    daily = [daily_row(el, ad_campaign) for el in elements]
    for ad_id in sorted({r["adId"] for r in daily} - set(ad_campaign)):  # deleted ads
        ads.append({"id": ad_id, "accountId": aid, "campaignId": None, "name": f"Ad {ad_id}",
                    "status": "Ended", "createdAt": None})
    known = {c["id"] for c in campaigns}
    for cid in sorted({a["campaignId"] for a in ads if a["campaignId"] is not None} - known):
        campaigns.append({"id": cid, "accountId": aid, "name": str(cid), "group": "",
                          "status": "UNKNOWN", "objective": "", "dailyBudget": None})
    account = {"id": aid, "label": cfg["label"], "name": acc.get("name", ""),
               "currency": acc.get("currency", "")}
    return account, campaigns, ads, daily


def build(accounts_cfg, api, today, now_iso):
    out = {"generatedAt": now_iso, "accounts": [], "campaigns": [], "ads": [], "daily": []}
    for cfg in accounts_cfg:
        account, campaigns, ads, daily = build_account(cfg, api, today)
        out["accounts"].append(account)
        out["campaigns"] += campaigns
        out["ads"] += ads
        out["daily"] += daily
    out["daily"].sort(key=lambda r: (r["date"], r["adId"]))
    return out


def main():
    li.load_env()
    expires_at = os.environ.get("LKDN_REFRESH_EXPIRES_AT")
    if expires_at and (msg := expiry_warning(float(expires_at), time.time())):
        print(f"::warning::{msg}")
    cfg = json.loads((ROOT / "accounts.json").read_text())
    data = build(cfg, li, date.today(), datetime.now(timezone.utc).isoformat(timespec="seconds"))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    for a in data["accounts"]:
        n_c = sum(1 for c in data["campaigns"] if c["accountId"] == a["id"])
        n_a = sum(1 for x in data["ads"] if x["accountId"] == a["id"])
        print(f"{a['label']}: {a['name']} ({a['currency']}), {n_c} campaigns, {n_a} ads")
    print(f"{len(data['daily'])} daily rows -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest discover -s tests -t .`
Expected: OK (21 tests: 4 linkedin_ads + 17 build_data).

- [ ] **Step 5: Real run + consistency check against v1 totals**

```bash
python3 -c "import json;d=json.load(open('site/data.json'));print('v1',sum(r['leads'] for r in d['daily']),round(sum(r['spend'] for r in d['daily']),2))"
python3 build_data.py
python3 -c "
import json;d=json.load(open('site/data.json'))
print('v2',sum(r['leads'] for r in d['daily']),round(sum(r['spend'] for r in d['daily']),2),len(d['ads']),'ads')
print('null campaign rows',sum(1 for r in d['daily'] if r['campaignId'] is None))"
```
Expected: prints `3CC: … N ads` and `C2: … M ads`; v2 leads within ±2% of v1 (LinkedIn approximates per pivot) and spend within ±1%; ad count ≥ 9.

- [ ] **Step 6: Commit**

```bash
git add build_data.py tests/test_build_data.py
git commit -m "Data: per-ad daily rows (pivot=CREATIVE) and ads list"
```

---

### Task 2: `metrics.js` — filter by ad, generic grouping

**Files:**
- Modify: `site/metrics.js`, `tests/metrics.test.mjs`

**Interfaces:**
- Produces (changed): `filterRows(daily, {start,end}, adIds: Set<number>)` filters on `r.adId`; `groupTotals(rows, key: "adId"|"campaignId") -> Map<id, totals>` (replaces `byCampaign`); `daysInclusive(start, end) -> number` now exported. Everything else unchanged.

- [ ] **Step 1: Update tests** — in `tests/metrics.test.mjs`:

Replace the `row` helper with:

```js
const row = (date, adId, o = {}) => ({ date, adId, campaignId: 10, impressions: 0, clicks: 0, landingPageClicks: 0,
  spend: 0, leadFormOpens: 0, leads: 0, engagements: 0, ...o });
```

Replace the `filterRows by date and campaign` test with:

```js
test("filterRows by date and ad", () => {
  const rows = [row("2026-09-30", 1), row("2026-10-01", 1), row("2026-10-01", 2), row("2026-10-02", 1)];
  const got = M.filterRows(rows, { start: "2026-09-30", end: "2026-10-01" }, new Set([1]));
  assert.deepEqual(got.map(r => r.date), ["2026-09-30", "2026-10-01"]);
});
```

Replace the `byCampaign groups totals` test with:

```js
test("groupTotals groups by any key", () => {
  const rows = [row("2026-09-30", 1, { spend: 1, campaignId: 10 }), row("2026-10-01", 1, { spend: 2, campaignId: 10 }),
                row("2026-10-01", 2, { spend: 5, campaignId: 20 })];
  assert.equal(M.groupTotals(rows, "adId").get(1).spend, 3);
  assert.equal(M.groupTotals(rows, "campaignId").get(20).spend, 5);
});

test("daysInclusive", () => {
  assert.equal(M.daysInclusive("2026-10-01", "2026-10-01"), 1);
  assert.equal(M.daysInclusive("2026-09-02", "2026-10-01"), 30);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/*.test.mjs`
Expected: FAIL — `filterRows by date and ad` (filters on campaignId), `M.groupTotals is not a function`, `M.daysInclusive is not a function`.

- [ ] **Step 3: Implement** — in `site/metrics.js`:

```js
export const daysInclusive = (start, end) => Math.round((toDate(end) - toDate(start)) / DAY_MS) + 1;
```
(replace the non-exported `const daysInclusive …` line), change `filterRows` to:

```js
export function filterRows(daily, { start, end }, adIds) {
  return daily.filter((r) => r.date >= start && r.date <= end && adIds.has(r.adId));
}
```

and replace `byCampaign` with:

```js
export function groupTotals(rows, key) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r[key])) groups.set(r[key], []);
    groups.get(r[key]).push(r);
  }
  return new Map([...groups].map(([id, rs]) => [id, totals(rs)]));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/*.test.mjs`
Expected: 11 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add site/metrics.js tests/metrics.test.mjs
git commit -m "Metrics: filter by ad, generic groupTotals"
```

(The v1 page is now out of sync with the data; Task 5 replaces it.)

---

### Task 3: `insights.js` — story, verdicts, rankings, highlights

**Files:**
- Create: `site/insights.js`, `tests/insights.test.mjs`

**Interfaces:**
- Consumes: `totals`, `ratios`, `delta`, `groupTotals` from `metrics.js`.
- Produces: `PERIOD_PHRASE`, `previousPhrase(days) -> string`, `story(preset, cur, prev, days, f) -> string` (`f` has `num(v)`, `money(v)`), `VERDICTS: {early, noLeads, star, costly, solid}` each `{icon, label, help}`, `verdict(t, avgCpl) -> key`, `adList(rows) -> [{id, ...totals, ...ratios}]`, `byLeads(list) -> list` (leads desc, cpl asc), `medals(list) -> Map<id, "🥇"|"🥈"|"🥉">`, `bestDay(days) -> {date, leads, …}|null`, `per1000(t) -> {clicks, formOpens, leads}|null`, `trend(cur, prev) -> string`.

- [ ] **Step 1: Write `tests/insights.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import * as I from "../site/insights.js";

const f = { num: (v) => String(Math.round(v)), money: (v) => `€${v.toFixed(2)}` };
const t = (o = {}) => ({ impressions: 0, clicks: 0, landingPageClicks: 0, spend: 0, leadFormOpens: 0, leads: 0,
  engagements: 0, ...o });
const r = (date, adId, o = {}) => ({ date, adId, campaignId: 1, ...t(o) });

test("previousPhrase", () => {
  assert.equal(I.previousPhrase(1), "the day before");
  assert.equal(I.previousPhrase(30), "the previous 30 days");
});

test("story: full sentence with comparison", () => {
  const cur = t({ impressions: 150574, clicks: 3036, leads: 354, spend: 6035.7 });
  const prev = t({ impressions: 1, leads: 350, spend: 5145 });
  assert.equal(I.story("30d", cur, prev, 30, f),
    "In the last 30 days, your ads were seen 150574 times, 3036 people clicked and 354 became leads, at €17.05 each (16% more than the previous 30 days).");
});

test("story: cheaper, same, no previous", () => {
  const cur = t({ impressions: 100, clicks: 5, leads: 10, spend: 90 });
  assert.match(I.story("7d", cur, t({ impressions: 1, leads: 10, spend: 100 }), 7, f), /\(10% less than the previous 7 days\)\.$/);
  assert.match(I.story("7d", cur, t({ impressions: 1, leads: 10, spend: 90 }), 7, f), /\(the same as the previous 7 days\)\.$/);
  assert.match(I.story("7d", cur, t(), 7, f), /at €9\.00 each\.$/);
});

test("story: singulars and no leads", () => {
  assert.equal(I.story("7d", t({ impressions: 50, clicks: 1, leads: 0 }), t(), 7, f),
    "In the last 7 days, your ads were seen 50 times, 1 person clicked and 0 became leads.");
  assert.match(I.story("7d", t({ impressions: 50, clicks: 2, leads: 1, spend: 5 }), t(), 7, f), /1 became a lead, at €5\.00 each\.$/);
});

test("story: period phrases", () => {
  const cur = t({ impressions: 1 });
  for (const [preset, phrase] of [["month", "This month"], ["lastmonth", "Last month"], ["ytd", "This year"], ["all", "Since the start"]]) {
    assert.ok(I.story(preset, cur, t(), 10, f).startsWith(`${phrase}, your ads were seen`), preset);
  }
});

test("story: no activity", () => {
  assert.equal(I.story("30d", t(), t({ impressions: 5 }), 30, f), "No ads ran in this period.");
});

test("verdict rules and boundaries", () => {
  assert.equal(I.verdict(t({ impressions: 999, leads: 5, spend: 10 }), 10), "early");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 0, spend: 50 }), 10), "noLeads");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 8 }), null), "solid");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 8 }), 10), "star");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 8.01 }), 10), "solid");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 15 }), 10), "costly");
  assert.equal(I.verdict(t({ impressions: 1000, leads: 1, spend: 14.99 }), 10), "solid");
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
  assert.equal(I.trend(t({ leads: 104, spend: 1160 }), t({ leads: 100, spend: 1000 })), "Leads rose 4%, cost per lead rose 12%.");
  assert.equal(I.trend(t({ leads: 50, spend: 400 }), t({ leads: 100, spend: 1000 })), "Leads fell 50%, cost per lead fell 20%.");
  assert.equal(I.trend(t({ leads: 100, spend: 1000 }), t({ leads: 100, spend: 1000 })), "Leads stayed the same, cost per lead stayed the same.");
  assert.equal(I.trend(t({ leads: 0 }), t({ leads: 10, spend: 50 })), "Leads fell 100%.");
  assert.equal(I.trend(t({ leads: 5 }), t()), "Not enough history to compare yet.");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/*.test.mjs`
Expected: FAIL — `Cannot find module '.../site/insights.js'`.

- [ ] **Step 3: Implement `site/insights.js`**

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/*.test.mjs`
Expected: all pass (11 metrics + 12 insights).

- [ ] **Step 5: Commit**

```bash
git add site/insights.js tests/insights.test.mjs
git commit -m "Insights: story sentence, verdicts, rankings, highlights"
```

---

### Task 4: `sheet.js` — daily sheet rows, shading, CSV

**Files:**
- Create: `site/sheet.js`, `tests/sheet.test.mjs`

**Interfaces:**
- Consumes: `byDate`, `totals`, `ratios` from `metrics.js`.
- Produces: `sheetRows(rows, range, level: "total"|"campaign"|"ad", nameOf: (id) => string) -> {rows: [{date, label, ...totals, ...ratios}], total: {...totals, ...ratios}}` (rows newest first; total level zero-fills days; other levels only impressions > 0, then label asc); `shadeStep(v, max) -> 0..5`; `toCsv(header: string[], lines: any[][]) -> string`; `sheetCsv(result, level) -> string`.

- [ ] **Step 1: Write `tests/sheet.test.mjs`**

```js
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

test("sheetCsv: totals first, raw numbers, label column only when grouped", () => {
  const total = S.sheetCsv(S.sheetRows(rows, range, "total", nameOf), "total").split("\n");
  assert.equal(total[0], "Date,Seen by,Clicks,Click rate,Form opens,Leads,Spend,Cost per lead");
  assert.equal(total[1], "Total,160,16,0.1,0,3,29,9.67");
  assert.equal(total[4], "2026-09-29,0,0,,0,0,0,");
  const ad = S.sheetCsv(S.sheetRows(rows, range, "ad", nameOf), "ad").split("\n");
  assert.equal(ad[0], "Date,Ad,Seen by,Clicks,Click rate,Form opens,Leads,Spend,Cost per lead");
  assert.equal(ad[4], "2026-09-30,\"Ad, \"\"two\"\"\",50,5,0.1,0,0,5,");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/*.test.mjs`
Expected: FAIL — `Cannot find module '.../site/sheet.js'`.

- [ ] **Step 3: Implement `site/sheet.js`**

```js
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

const cell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header, lines) => [header, ...lines].map((l) => l.map(cell).join(",")).join("\n") + "\n";

const LABEL = { campaign: "Campaign", ad: "Ad" };

export function sheetCsv({ rows, total }, level) {
  const grouped = level !== "total";
  const head = ["Date", ...(grouped ? [LABEL[level]] : []), "Seen by", "Clicks", "Click rate", "Form opens",
    "Leads", "Spend", "Cost per lead"];
  const line = (r, date) => [date, ...(grouped ? [r.label] : []), r.impressions, r.clicks,
    r.ctr == null ? null : +r.ctr.toFixed(4), r.leadFormOpens, r.leads, r.spend,
    r.cpl == null ? null : +r.cpl.toFixed(2)];
  return toCsv(head, [line({ ...total, label: "" }, "Total"), ...rows.map((r) => line(r, r.date))]);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/*.test.mjs`
Expected: all pass (11 + 12 + 6).

- [ ] **Step 5: Commit**

```bash
git add site/sheet.js tests/sheet.test.mjs
git commit -m "Sheet: daily rows per level, shading, CSV export"
```

---

### Task 5: Dashboard UI v2 (tabs, overview, ads, sheet)

**Files:**
- Replace: `site/index.html`, `site/style.css`, `site/app.js`
- Create: `site/ui.js`, `site/overview.js`, `site/ads.js`, `site/sheet-view.js`

**Interfaces:**
- Consumes: Tasks 1–4 (`data.json` v2, `metrics.js`, `insights.js`, `sheet.js`), global `Chart`.
- Produces: `ui.js` exports `DASH`, `GLOSSARY`, `el(tag, cls?, text?)`, `formatters(currency) -> {num, money, pct, compact, per1000, day, longDay, sheetDay}`, `info(text) -> HTMLElement`, `countUp(node, target, format)`, `drawChart(id, type, labels, values, fmt, tick)`, `sparkline(values) -> SVGElement`. Tab modules export `renderOverview(ctx)`, `renderAds(ctx, {onSort, onSeeDaily})`, `renderSheet(ctx, {onLevel, onClearAd})` where `ctx = {data, state, range, days, rows, prevRows, f, adsById, campaignsById}`.

- [ ] **Step 1: `site/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LinkedIn Ads Dashboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📈</text></svg>">
  <link rel="stylesheet" href="style.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
  <script type="module" src="app.js"></script>
</head>
<body class="loading">
  <header class="top">
    <div class="title">
      <h1>LinkedIn Ads</h1>
      <p id="updated" class="muted">Loading the latest numbers…</p>
    </div>
    <div class="filters">
      <div id="accounts" class="seg" role="group" aria-label="Account"></div>
      <label class="field">Period
        <select id="range">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
          <option value="lastmonth">Last month</option>
          <option value="ytd">Year to date</option>
          <option value="all">All time</option>
        </select>
      </label>
      <label class="field">Campaign <select id="campaign"></select></label>
    </div>
  </header>
  <nav class="tabs" role="tablist" aria-label="Views">
    <button type="button" role="tab" id="tab-overview" data-tab="overview" aria-controls="panel-overview">Overview</button>
    <button type="button" role="tab" id="tab-ads" data-tab="ads" aria-controls="panel-ads">Ads</button>
    <button type="button" role="tab" id="tab-sheet" data-tab="sheet" aria-controls="panel-sheet">Daily sheet</button>
  </nav>
  <main>
    <p id="error" class="error" role="alert" hidden></p>

    <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
      <p id="story" class="story"><span class="skeleton line"></span><span class="skeleton line short"></span></p>
      <div id="tiles" class="kpis">
        <div class="skeleton tile"></div><div class="skeleton tile"></div><div class="skeleton tile"></div><div class="skeleton tile"></div>
      </div>
      <div id="highlights" class="highlights"></div>
      <section id="per1000-section" class="per1000-section" hidden>
        <h2>Out of 1,000 people who saw your ads…</h2>
        <ol id="per1000" class="per1000"></ol>
      </section>
      <div class="charts">
        <figure class="card"><figcaption>Leads per day</figcaption><div class="plot"><canvas id="chart-leads" role="img" aria-label="Leads per day"></canvas></div></figure>
        <figure class="card"><figcaption>Cost per lead, per day</figcaption><div class="plot"><canvas id="chart-cpl" role="img" aria-label="Cost per lead per day"></canvas></div></figure>
      </div>
    </section>

    <section id="panel-ads" role="tabpanel" aria-labelledby="tab-ads" hidden>
      <div class="panel-head">
        <h2>Your ads</h2>
        <label class="field">Sort by
          <select id="ad-sort">
            <option value="leads">Most leads</option>
            <option value="cheapest">Cheapest leads</option>
            <option value="spend">Most spend</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>
      <div id="ads-grid" class="ads-grid"></div>
      <p id="ads-empty" class="empty" hidden>No ads ran in this period.</p>
    </section>

    <section id="panel-sheet" role="tabpanel" aria-labelledby="tab-sheet" hidden>
      <div class="panel-head">
        <h2>Daily numbers</h2>
        <div class="sheet-tools">
          <label class="field">Show
            <select id="level">
              <option value="total">All combined</option>
              <option value="campaign">By campaign</option>
              <option value="ad">By ad</option>
            </select>
          </label>
          <button id="ad-chip" class="chip" type="button" hidden></button>
          <button id="csv" class="btn" type="button">Download CSV</button>
        </div>
      </div>
      <div class="sheet-wrap"><table id="sheet"><thead></thead><tbody></tbody></table></div>
      <p id="sheet-empty" class="empty" hidden>No ads ran in this period.</p>
    </section>
  </main>
</body>
</html>
```

- [ ] **Step 2: `site/style.css`**

```css
:root {
  color-scheme: light;
  --surface: #fcfcfb;
  --surface-2: #ffffff;
  --border: #e4e3df;
  --grid: #ecebe7;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #6f6e69;
  --series-1: #2a78d6;
  --good: #0f7b3e;
  --good-bg: #e6f4ec;
  --bad: #c4312f;
  --bad-bg: #fbeaea;
  --warn: #8a5a00;
  --warn-bg: #fdf3dc;
  --accent-bg: #e8f1fc;
  --shade-1: #e3eefc; --shade-2: #cde2fb; --shade-3: #b7d3f6; --shade-4: #9ec5f4; --shade-5: #86b6ef;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --surface-2: #232322; --border: #3a3a37; --grid: #2e2e2c;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #9b9a92;
    --series-1: #3987e5; --good: #4cc38a; --good-bg: #173326; --bad: #f07272; --bad-bg: #3a1d1d;
    --warn: #e3b341; --warn-bg: #3a2f12; --accent-bg: #1c2f48;
    --shade-1: #16283d; --shade-2: #10325a; --shade-3: #104281; --shade-4: #184f95; --shade-5: #1c5cab;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --surface-2: #232322; --border: #3a3a37; --grid: #2e2e2c;
  --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #9b9a92;
  --series-1: #3987e5; --good: #4cc38a; --good-bg: #173326; --bad: #f07272; --bad-bg: #3a1d1d;
  --warn: #e3b341; --warn-bg: #3a2f12; --accent-bg: #1c2f48;
  --shade-1: #16283d; --shade-2: #10325a; --shade-3: #104281; --shade-4: #184f95; --shade-5: #1c5cab;
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--surface); color: var(--text-primary);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.top, .tabs, main { max-width: 1120px; margin: 0 auto; padding: 0 16px; }
.top { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: end; justify-content: space-between; padding-top: 24px; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 16px; margin: 0; color: var(--text-secondary); font-weight: 600; }
.muted { color: var(--text-muted); margin: 2px 0 0; font-size: 13px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.seg button { border: 0; background: var(--surface-2); color: var(--text-secondary); padding: 6px 12px; font: inherit; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--border); }
.seg button[aria-pressed="true"] { background: var(--accent-bg); color: var(--text-primary); font-weight: 600; }
.field { display: inline-flex; gap: 6px; align-items: center; color: var(--text-secondary); font-size: 13px; }
select, .chip, .btn { font: inherit; color: var(--text-primary); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; }
#campaign { max-width: 220px; }
.chip, .btn { cursor: pointer; }
.chip { background: var(--accent-bg); }
.btn:hover, .chip:hover { border-color: var(--series-1); }
.error { background: var(--surface-2); border: 1px solid var(--bad); border-radius: 8px; padding: 12px; margin-top: 16px; }

.tabs { display: flex; gap: 4px; margin-top: 20px; border-bottom: 1px solid var(--border); overflow-x: auto; }
.tabs button { border: 0; background: none; font: inherit; color: var(--text-secondary); padding: 10px 14px; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -1px; white-space: nowrap; }
.tabs button[aria-selected="true"] { color: var(--text-primary); font-weight: 600; border-bottom-color: var(--series-1); }
.tabs button:focus-visible { outline: 2px solid var(--series-1); outline-offset: -2px; }
[role="tabpanel"] { padding-top: 24px; animation: fade .25s ease; }
@keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
main { padding-bottom: 48px; }

.story { font-size: 21px; line-height: 1.45; margin: 0 0 20px; max-width: 62ch; font-weight: 500; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.kpi { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.kpi-label { color: var(--text-secondary); font-size: 13px; }
.kpi-value { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 2px 0; letter-spacing: -0.01em; }
.kpi-delta { font-size: 12px; color: var(--text-muted); }
.kpi-delta.good { color: var(--good); }
.kpi-delta.bad { color: var(--bad); }

.highlights { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 12px; }
.highlight { background: var(--accent-bg); border-radius: 12px; padding: 14px 16px; }
.hl-title { font-size: 13px; color: var(--text-secondary); font-weight: 600; }
.hl-main { font-size: 17px; font-weight: 600; margin-top: 4px; overflow-wrap: anywhere; }
.hl-sub { font-size: 13px; color: var(--text-secondary); }

.per1000-section { margin-top: 28px; }
.per1000 { list-style: none; padding: 0; margin: 12px 0 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.per1000 li { position: relative; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.per1000 li + li::before { content: "→"; position: absolute; left: -11px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 14px; }
.p-value { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.p-text { font-size: 13px; color: var(--text-secondary); }

.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-top: 28px; }
.card { margin: 0; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; min-width: 0; }
.card figcaption { color: var(--text-secondary); font-size: 13px; margin-bottom: 8px; }
.plot { position: relative; height: 200px; }

.panel-head { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.sheet-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.empty { color: var(--text-muted); text-align: center; padding: 32px 0; }

.ads-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; }
.ad-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 10px; transition: transform .15s ease, box-shadow .15s ease; }
.ad-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgb(0 0 0 / .08); }
.ad-top { display: flex; gap: 8px; align-items: baseline; }
.medal { font-size: 22px; line-height: 1; }
.ad-name { font-size: 16px; margin: 0; overflow-wrap: anywhere; }
.ad-meta { font-size: 13px; color: var(--text-secondary); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--grid); color: var(--text-secondary); }
.pill-running { background: var(--good-bg); color: var(--good); }
.pill-not-delivering { background: var(--warn-bg); color: var(--warn); }
.ad-big { display: flex; flex-direction: column; }
.ad-big strong { font-size: 28px; font-variant-numeric: tabular-nums; }
.ad-big span { color: var(--text-secondary); }
.ad-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 0; }
.ad-stats dt { font-size: 11px; color: var(--text-muted); }
.ad-stats dd { margin: 0; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.spark-wrap { color: var(--series-1); }
.spark-label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
.spark { width: 100%; height: 32px; display: block; }
.verdict { font-size: 13px; font-weight: 600; padding: 6px 10px; border-radius: 8px; background: var(--grid); color: var(--text-primary); }
.verdict-star { background: var(--good-bg); color: var(--good); }
.verdict-costly { background: var(--bad-bg); color: var(--bad); }
.verdict-noLeads { background: var(--warn-bg); color: var(--warn); }
.verdict-early { color: var(--text-secondary); }
.link { all: unset; cursor: pointer; color: var(--series-1); font-size: 13px; font-weight: 600; align-self: flex-start; }
.link:hover, .link:focus-visible { text-decoration: underline; }

.sheet-wrap { overflow: auto; max-height: 70vh; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); }
#sheet { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
#sheet th, #sheet td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; background: var(--surface-2); }
#sheet .col-date, #sheet .col-label { text-align: left; }
#sheet .col-label { white-space: normal; min-width: 160px; }
#sheet thead { position: sticky; top: 0; z-index: 2; }
#sheet thead th { color: var(--text-secondary); font-weight: 600; }
#sheet .totals td { font-weight: 700; background: var(--accent-bg); }
#sheet .col-date { position: sticky; left: 0; z-index: 1; }
#sheet thead .col-date { z-index: 3; }
#sheet tbody tr:hover td { background: var(--accent-bg); }
#sheet td.shade-1 { background: var(--shade-1); } #sheet td.shade-2 { background: var(--shade-2); }
#sheet td.shade-3 { background: var(--shade-3); } #sheet td.shade-4 { background: var(--shade-4); }
#sheet td.shade-5 { background: var(--shade-5); }
#sheet th .info-tip { bottom: auto; top: calc(100% + 6px); left: auto; right: 0; }

.info { position: relative; display: inline-block; margin-left: 4px; }
.info-btn { all: unset; cursor: help; color: var(--text-muted); font-size: 12px; line-height: 1; padding: 2px; }
.info-btn:focus-visible { outline: 2px solid var(--series-1); border-radius: 4px; }
.info-tip { display: none; position: absolute; z-index: 20; bottom: calc(100% + 6px); left: -8px; width: max-content; max-width: 240px; padding: 8px 10px; border-radius: 8px; background: var(--text-primary); color: var(--surface); font-size: 12px; font-weight: 400; line-height: 1.4; white-space: normal; text-align: left; box-shadow: 0 4px 12px rgb(0 0 0 / .15); }
.info:hover .info-tip, .info:focus-within .info-tip { display: block; }

.skeleton { display: block; border-radius: 8px; background: linear-gradient(90deg, var(--grid) 25%, var(--surface-2) 50%, var(--grid) 75%); background-size: 200% 100%; animation: shimmer 1.2s infinite linear; }
.skeleton.line { height: 24px; margin: 6px 0; }
.skeleton.short { width: 55%; }
.skeleton.tile { height: 104px; border-radius: 12px; }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton, [role="tabpanel"] { animation: none; } .ad-card { transition: none; } }

@media (max-width: 640px) {
  .story { font-size: 18px; }
  .kpis { grid-template-columns: 1fr 1fr; }
  .kpi-value { font-size: 24px; }
  .per1000 { grid-template-columns: 1fr 1fr; }
  .per1000 li:nth-child(3)::before { display: none; }
  .ads-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: `site/ui.js`**

```js
// Shared DOM helpers: element builder, formatters, glossary, ⓘ tooltips, count-up, charts, sparklines.
import { toDate } from "./metrics.js";

export const DASH = "—";

export const GLOSSARY = {
  impressions: "Seen by (impressions): how many times your ads were shown on screen.",
  clicks: "Clicks: how many times someone clicked your ad.",
  ctr: "Click rate (CTR): out of 100 people who saw the ad, how many clicked.",
  leadFormOpens: "Form opens: how many people opened your lead form.",
  leads: "Leads: people who filled in and sent your form.",
  cpl: "Cost per lead: what you paid on average for each lead (spend ÷ leads).",
  spend: "Spend: what LinkedIn charged for the period.",
  formRate: "Form completion: out of 100 people who opened the form, how many sent it.",
};

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function formatters(currency) {
  const num = new Intl.NumberFormat("en-IE");
  const money = new Intl.NumberFormat("en-IE", { style: "currency", currency });
  const pct = new Intl.NumberFormat("en-IE", { style: "percent", maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat("en-IE", { notation: "compact" });
  const date = (iso, opts) => toDate(iso).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  return {
    num: (v) => (v == null ? DASH : num.format(Math.round(v))),
    money: (v) => (v == null ? DASH : money.format(v)),
    pct: (v) => (v == null ? DASH : pct.format(v)),
    compact: (v) => compact.format(v),
    per1000: (v) => (v < 10 ? v.toFixed(1) : num.format(Math.round(v))),
    day: (iso) => date(iso, { day: "numeric", month: "short" }),
    longDay: (iso) => date(iso, { weekday: "long", day: "numeric", month: "short" }),
    sheetDay: (iso) => date(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
  };
}

let tipCount = 0;
export function info(text) {
  const wrap = el("span", "info");
  const btn = el("button", "info-btn", "ⓘ");
  btn.type = "button";
  btn.setAttribute("aria-label", "What does this mean?");
  const tip = el("span", "info-tip", text);
  tip.id = `tip-${++tipCount}`;
  tip.setAttribute("role", "tooltip");
  btn.setAttribute("aria-describedby", tip.id);
  btn.addEventListener("keydown", (e) => { if (e.key === "Escape") btn.blur(); });
  wrap.append(btn, tip);
  return wrap;
}

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
export function countUp(node, target, format) {
  const from = node._value ?? 0;
  node._value = target;
  if (target == null || reduceMotion.matches || from === target) {
    node.textContent = format(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    if (node._value !== target) return;  // a newer render took over
    const p = Math.min((now - start) / 600, 1);
    node.textContent = format(from + (target - from) * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const charts = {};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function drawChart(id, type, labels, values, fmt, tick) {
  charts[id]?.destroy();
  const series = cssVar("--series-1"), muted = cssVar("--text-muted"), grid = cssVar("--grid");
  charts[id] = new Chart(document.getElementById(id), {
    type,
    data: {
      labels,
      datasets: [{
        data: values, backgroundColor: series, borderColor: series, borderWidth: 2,
        borderRadius: 4, maxBarThickness: 18, categoryPercentage: 0.9, barPercentage: 0.9,
        pointHoverRadius: 4,
        // show a dot only for isolated values, otherwise a line with gaps would hide them
        pointRadius: (ctx) => {
          const d = ctx.dataset.data, i = ctx.dataIndex;
          return d[i] != null && d[i - 1] == null && d[i + 1] == null ? 4 : 0;
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { label: (ctx) => fmt(ctx.parsed.y) } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: grid }, ticks: { color: muted, maxTicksLimit: 6, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false },
             ticks: { color: muted, maxTicksLimit: 5, callback: (v) => tick(v) } },
      },
    },
  });
}

export function sparkline(values) {
  const ns = "http://www.w3.org/2000/svg", w = 120, h = 32;
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? w / (values.length - 1) : 0;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", values.map((v, i) => `${(i * stepX).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" "));
  for (const [k, v] of [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"],
    ["stroke-linejoin", "round"], ["vector-effect", "non-scaling-stroke"]]) line.setAttribute(k, v);
  svg.append(line);
  return svg;
}
```

- [ ] **Step 4: `site/overview.js`**

```js
// Overview tab: story, headline tiles, highlights, per-1,000 funnel, daily charts.
import * as M from "./metrics.js";
import * as I from "./insights.js";
import { el, info, countUp, drawChart, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);

const TILES = [
  { key: "leads", label: "Leads", good: "up" },
  { key: "cpl", label: "Cost per lead", good: "down" },
  { key: "spend", label: "Spend", good: null },
  { key: "impressions", label: "Seen by", good: "up" },
];

function setDelta(node, d, good, phrase) {
  node.className = "kpi-delta";
  if (d == null) { node.textContent = "No earlier data to compare"; return; }
  const p = Math.round(d * 100);
  if (p === 0) { node.textContent = `= Same as ${phrase}`; return; }
  node.textContent = `${p > 0 ? "▲" : "▼"} ${Math.abs(p)}% vs ${phrase}`;
  if (good) node.classList.add((p > 0) === (good === "up") ? "good" : "bad");
}

function renderTiles(cur, prev, days, f) {
  const box = $("tiles");
  if (box.dataset.ready !== "1") {
    box.replaceChildren(...TILES.map((t) => {
      const tile = el("div", "kpi");
      tile.dataset.key = t.key;
      const label = el("div", "kpi-label", t.label);
      label.append(info(GLOSSARY[t.key]));
      tile.append(label, el("div", "kpi-value"), el("div", "kpi-delta"));
      return tile;
    }));
    box.dataset.ready = "1";
  }
  const r = M.ratios(cur), pr = M.ratios(prev);
  const values = {
    leads: [cur.leads, prev.leads, f.num], cpl: [r.cpl, pr.cpl, f.money],
    spend: [cur.spend, prev.spend, f.money], impressions: [cur.impressions, prev.impressions, f.num],
  };
  for (const t of TILES) {
    const tile = box.querySelector(`[data-key="${t.key}"]`);
    const [v, p, fmt] = values[t.key];
    countUp(tile.querySelector(".kpi-value"), v, fmt);
    setDelta(tile.querySelector(".kpi-delta"), M.delta(v, p), t.good, I.previousPhrase(days));
  }
}

const highlight = (title, main, sub) => {
  const c = el("div", "highlight");
  c.append(el("div", "hl-title", title), el("div", "hl-main", main), el("div", "hl-sub", sub));
  return c;
};

function renderHighlights(rows, range, cur, prev, f, adsById) {
  const best = I.byLeads(I.adList(rows)).find((a) => a.leads > 0);
  const day = I.bestDay(M.byDate(rows, range));
  const cards = [];
  if (best) cards.push(highlight("🥇 Best ad", adsById.get(best.id)?.name || `Ad ${best.id}`,
    `${f.num(best.leads)} leads · ${f.money(best.cpl)} per lead`));
  if (day) cards.push(highlight("📅 Best day", f.longDay(day.date), `${f.num(day.leads)} leads`));
  cards.push(highlight("📈 Trend", I.trend(cur, prev), "Compared with the period just before"));
  $("highlights").replaceChildren(...cards);
}

function renderPer1000(cur, f) {
  const p = I.per1000(cur);
  $("per1000-section").hidden = !p;
  if (!p) return;
  const steps = [["1,000", "people saw your ads"], [f.per1000(p.clicks), "clicked on an ad"],
    [f.per1000(p.formOpens), "opened the form"], [f.per1000(p.leads), "sent it and became leads"]];
  $("per1000").replaceChildren(...steps.map(([v, text]) => {
    const li = el("li");
    li.append(el("div", "p-value", v), el("div", "p-text", text));
    return li;
  }));
}

export function renderOverview({ rows, prevRows, range, days, state, f, adsById }) {
  const cur = M.totals(rows), prev = M.totals(prevRows);
  $("story").textContent = I.story(state.range, cur, prev, days, f);
  renderTiles(cur, prev, days, f);
  renderHighlights(rows, range, cur, prev, f, adsById);
  renderPer1000(cur, f);
  const series = M.byDate(rows, range);
  const labels = series.map((d) => f.day(d.date));
  drawChart("chart-leads", "bar", labels, series.map((d) => d.leads), f.num, f.compact);
  drawChart("chart-cpl", "line", labels, series.map((d) => (d.leads ? d.spend / d.leads : null)), f.money, f.compact);
}
```

- [ ] **Step 5: `site/ads.js`**

```js
// Ads tab: one card per ad with results, verdict, medal and a leads sparkline.
import * as M from "./metrics.js";
import * as I from "./insights.js";
import { el, info, sparkline } from "./ui.js";

const $ = (id) => document.getElementById(id);

function sortAds(list, sort, adsById) {
  const copy = [...list];
  if (sort === "cheapest") return copy.sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity) || b.leads - a.leads);
  if (sort === "spend") return copy.sort((a, b) => b.spend - a.spend);
  if (sort === "newest") {
    const created = (a) => adsById.get(a.id)?.createdAt || "";
    return copy.sort((a, b) => created(b).localeCompare(created(a)));
  }
  return I.byLeads(copy);
}

function adCard(a, ad, campaign, medal, verdictKey, sparkValues, f, onSeeDaily) {
  const card = el("article", "ad-card");
  const top = el("div", "ad-top");
  if (medal) top.append(el("span", "medal", medal));
  top.append(el("h3", "ad-name", ad?.name || `Ad ${a.id}`));

  const status = ad?.status || "Ended";
  const meta = el("div", "ad-meta", campaign?.name || "Unknown campaign");
  meta.append(el("span", `pill pill-${status.toLowerCase().replace(/\s+/g, "-")}`, status));

  const big = el("div", "ad-big");
  big.append(el("strong", null, `${f.num(a.leads)} ${a.leads === 1 ? "lead" : "leads"}`),
    el("span", null, a.cpl == null ? "No leads yet" : `${f.money(a.cpl)} per lead`));

  const stats = el("dl", "ad-stats");
  for (const [label, value] of [["Seen by", f.num(a.impressions)], ["Clicks", f.num(a.clicks)],
    ["Click rate", f.pct(a.ctr)], ["Spend", f.money(a.spend)]]) {
    const item = el("div");
    item.append(el("dt", null, label), el("dd", null, value));
    stats.append(item);
  }

  const spark = el("div", "spark-wrap");
  spark.append(el("span", "spark-label", "Leads per day"), sparkline(sparkValues));

  const v = I.VERDICTS[verdictKey];
  const verdict = el("div", `verdict verdict-${verdictKey}`, `${v.icon} ${v.label}`);
  verdict.append(info(v.help));

  const link = el("button", "link", "See daily numbers →");
  link.type = "button";
  link.onclick = () => onSeeDaily(a.id);

  card.append(top, meta, big, stats, spark, verdict, link);
  return card;
}

export function renderAds({ rows, range, state, f, adsById, campaignsById }, { onSort, onSeeDaily }) {
  $("ad-sort").value = state.sort;
  $("ad-sort").onchange = (e) => onSort(e.target.value);
  const list = I.adList(rows).filter((a) => a.impressions > 0);
  const avgCpl = M.ratios(M.totals(rows)).cpl;
  const medal = I.medals(list);
  $("ads-empty").hidden = list.length > 0;
  $("ads-grid").replaceChildren(...sortAds(list, state.sort, adsById).map((a) => {
    const ad = adsById.get(a.id);
    const spark = M.byDate(rows.filter((r) => r.adId === a.id), range).map((d) => d.leads);
    return adCard(a, ad, campaignsById.get(ad?.campaignId), medal.get(a.id), I.verdict(a, avgCpl), spark, f, onSeeDaily);
  }));
}
```

- [ ] **Step 6: `site/sheet-view.js`**

```js
// Daily sheet tab: spreadsheet-like table with totals, leads shading and CSV download.
import * as S from "./sheet.js";
import { el, info, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);

const COLS = [
  { key: "impressions", label: "Seen by", fmt: "num" },
  { key: "clicks", label: "Clicks", fmt: "num" },
  { key: "ctr", label: "Click rate", fmt: "pct" },
  { key: "leadFormOpens", label: "Form opens", fmt: "num" },
  { key: "leads", label: "Leads", fmt: "num" },
  { key: "spend", label: "Spend", fmt: "money" },
  { key: "cpl", label: "Cost per lead", fmt: "money" },
];
const LABEL_COL = { campaign: "Campaign", ad: "Ad" };

function rowEl(r, dateText, hasLabel, f, maxLeads) {
  const tr = el("tr");
  tr.append(el("td", "col-date", dateText));
  if (hasLabel) tr.append(el("td", "col-label", r.label ?? ""));
  for (const c of COLS) {
    const td = el("td", null, f[c.fmt](r[c.key]));
    if (c.key === "leads") {
      const step = S.shadeStep(r.leads, maxLeads);
      if (step) td.classList.add(`shade-${step}`);
    }
    tr.append(td);
  }
  return tr;
}

export function renderSheet({ rows, range, state, f, adsById, campaignsById }, { onLevel, onClearAd }) {
  const ad = state.ad ? adsById.get(state.ad) : null;
  const scoped = ad ? rows.filter((r) => r.adId === ad.id) : rows;
  const level = state.level;
  const nameOf = level === "campaign"
    ? (id) => campaignsById.get(id)?.name || "Unknown campaign"
    : (id) => adsById.get(id)?.name || `Ad ${id}`;
  const result = S.sheetRows(scoped, range, level, nameOf);
  const hasLabel = level !== "total";

  $("level").value = level;
  $("level").onchange = (e) => onLevel(e.target.value);
  const chip = $("ad-chip");
  chip.hidden = !ad;
  if (ad) { chip.textContent = `Ad: ${ad.name} ✕`; chip.onclick = onClearAd; }

  const head = el("tr");
  head.append(el("th", "col-date", "Date"));
  if (hasLabel) head.append(el("th", "col-label", LABEL_COL[level]));
  for (const c of COLS) {
    const th = el("th", null, c.label);
    th.append(info(GLOSSARY[c.key]));
    head.append(th);
  }
  const totalRow = rowEl({ ...result.total, label: "" }, "Total", hasLabel, f, 0);
  totalRow.className = "totals";
  $("sheet").tHead.replaceChildren(head, totalRow);

  const maxLeads = Math.max(0, ...result.rows.map((r) => r.leads));
  $("sheet").tBodies[0].replaceChildren(...result.rows.map((r) => rowEl(r, f.sheetDay(r.date), hasLabel, f, maxLeads)));
  $("sheet-empty").hidden = result.rows.some((r) => r.impressions > 0);

  $("csv").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿", S.sheetCsv(result, level)], { type: "text/csv;charset=utf-8" }));
    a.download = `linkedin-ads-${state.account}-${range.start}-${range.end}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}
```

- [ ] **Step 7: `site/app.js`**

```js
// App shell: state in the URL hash, header controls, tabs; delegates each tab to its module.
import * as M from "./metrics.js";
import { el, formatters } from "./ui.js";
import { renderOverview } from "./overview.js";
import { renderAds } from "./ads.js";
import { renderSheet } from "./sheet-view.js";

const TABS = ["overview", "ads", "sheet"];
const RANGES = ["7d", "30d", "month", "lastmonth", "ytd", "all"];
const LEVELS = ["total", "campaign", "ad"];
const state = { tab: "overview", account: "all", range: "30d", campaign: null, ad: null, level: "total", sort: "leads" };
let data, adsById, campaignsById, activeCampaignIds;
const $ = (id) => document.getElementById(id);
const numOrNull = (v) => (v ? Number(v) : null);

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (TABS.includes(p.get("tab"))) state.tab = p.get("tab");
  if (p.get("acc")) state.account = p.get("acc");
  if (RANGES.includes(p.get("range"))) state.range = p.get("range");
  if (LEVELS.includes(p.get("level"))) state.level = p.get("level");
  state.campaign = numOrNull(p.get("c"));
  state.ad = numOrNull(p.get("ad"));
}

function writeHash() {
  const p = new URLSearchParams({ tab: state.tab, acc: state.account, range: state.range });
  if (state.campaign) p.set("c", state.campaign);
  if (state.tab === "sheet") {
    p.set("level", state.level);
    if (state.ad) p.set("ad", state.ad);
  }
  history.replaceState(null, "", `#${p}`);
}

const selectedAccounts = () =>
  state.account === "all" ? data.accounts : data.accounts.filter((a) => a.label === state.account);

// Ads in scope for the account + campaign filters; drops filters that don't belong (e.g. shared links).
function selectedAds() {
  const accIds = new Set(selectedAccounts().map((a) => a.id));
  const ads = data.ads.filter((a) => accIds.has(a.accountId));
  if (state.campaign && !ads.some((a) => a.campaignId === state.campaign)) state.campaign = null;
  const scoped = state.campaign ? ads.filter((a) => a.campaignId === state.campaign) : ads;
  if (state.ad && !scoped.some((a) => a.id === state.ad)) state.ad = null;
  return scoped;
}

function renderHeader() {
  const labels = data.accounts.map((a) => a.label);
  if (labels.length > 1) labels.push("all");
  $("accounts").replaceChildren(...labels.map((label) => {
    const b = el("button", null, label === "all" ? (data.accounts.length === 2 ? "Both" : "All") : label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(state.account === label));
    b.onclick = () => { Object.assign(state, { account: label, campaign: null, ad: null }); render(); };
    return b;
  }));
  $("range").value = state.range;

  const accIds = new Set(selectedAccounts().map((a) => a.id));
  const options = data.campaigns
    .filter((c) => accIds.has(c.accountId) && activeCampaignIds.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  $("campaign").replaceChildren(new Option("All campaigns", ""), ...options.map((c) => new Option(c.name, c.id)));
  $("campaign").value = state.campaign ?? "";

  for (const t of TABS) {
    $(`tab-${t}`).setAttribute("aria-selected", String(state.tab === t));
    $(`panel-${t}`).hidden = state.tab !== t;
  }
}

function render() {
  const ads = selectedAds();
  renderHeader();
  const adIds = new Set(ads.map((a) => a.id));
  const today = M.todayIso();
  const firstDate = data.daily.find((r) => adIds.has(r.adId))?.date || today;
  const range = M.rangeFor(state.range, today, firstDate);
  const ctx = {
    data, state, range, days: M.daysInclusive(range.start, range.end),
    rows: M.filterRows(data.daily, range, adIds),
    prevRows: M.filterRows(data.daily, M.previousRange(range), adIds),
    f: formatters(selectedAccounts()[0]?.currency || "EUR"),
    adsById, campaignsById,
  };
  if (state.tab === "overview") renderOverview(ctx);
  if (state.tab === "ads") {
    renderAds(ctx, {
      onSort: (sort) => { state.sort = sort; render(); },
      onSeeDaily: (id) => { Object.assign(state, { tab: "sheet", level: "ad", ad: id }); render(); window.scrollTo(0, 0); },
    });
  }
  if (state.tab === "sheet") {
    renderSheet(ctx, {
      onLevel: (level) => { state.level = level; render(); },
      onClearAd: () => { state.ad = null; render(); },
    });
  }
  writeHash();
}

async function init() {
  readHash();
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    $("error").textContent = `Could not load the data (${e.message}). The next scheduled refresh should fix this.`;
    $("error").hidden = false;
    $("updated").textContent = "";
    document.body.classList.remove("loading");
    return;
  }
  adsById = new Map(data.ads.map((a) => [a.id, a]));
  campaignsById = new Map(data.campaigns.map((c) => [c.id, c]));
  activeCampaignIds = new Set(data.daily.map((r) => r.campaignId));
  const labels = data.accounts.map((a) => a.label);
  if (labels.length === 1) state.account = labels[0];
  else if (!labels.includes(state.account)) state.account = "all";

  $("updated").textContent = `Updated ${new Date(data.generatedAt).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`;
  $("range").onchange = (e) => { state.range = e.target.value; render(); };
  $("campaign").onchange = (e) => { state.campaign = numOrNull(e.target.value); state.ad = null; render(); };
  for (const t of TABS) $(`tab-${t}`).onclick = () => { state.tab = t; render(); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  document.body.classList.remove("loading");
  render();
}

init();
```

- [ ] **Step 8: Syntax check and unit suites**

Run: `for f in site/*.js; do node --check "$f" || exit 1; done && node --test tests/*.test.mjs && python3 -m unittest discover -s tests -t .`
Expected: no syntax errors; all JS and Python tests pass.

- [ ] **Step 9: Browser check** (`python3 -m http.server 8000 -d site`, Chrome at `http://localhost:8000`)

Verify, with no console errors throughout:
- Overview: story sentence matches the tiles; tiles count up; ⓘ shows text on hover and on keyboard focus, hides on Escape; highlights show best ad / best day / trend; per-1,000 steps; both charts.
- 3CC / C2 / Both and every period: no "NaN", "Infinity" or "undefined" anywhere (`document.body.innerText`); Both leads = 3CC + C2.
- Campaign dropdown lists only campaigns of the selected account(s); choosing one changes all tabs; switching account resets it.
- Ads: cards sorted by leads, medals on top 3 with leads, verdicts present, each sort option works; "See daily numbers →" opens the sheet filtered to that ad with the chip; the chip clears it.
- Sheet: All combined shows every day of the period (zeros included); By campaign / By ad add the name column; totals row stays visible when scrolling; leads shading visible; Download CSV opens in a spreadsheet with correct accents.
- Shared-link guard: open `#tab=sheet&acc=C2&c=<a 3CC campaign id>&ad=<a 3CC ad id>` → page shows all of C2, no chip.
- "Last 7 days" on an account/campaign with no recent activity shows "No ads ran in this period." on all tabs.
- Dark mode (`document.documentElement.dataset.theme='dark'` then re-render) and 390 px width (iframe) look right; sheet scrolls sideways with Date column fixed.
- `data.json` missing → error box.

- [ ] **Step 10: Commit**

```bash
git add site/index.html site/style.css site/app.js site/ui.js site/overview.js site/ads.js site/sheet-view.js
git commit -m "Dashboard v2: Overview, Ads and Daily sheet tabs in plain English"
```

---

### Task 6: README and release (user confirmation required to push)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the "How it works" list in `README.md`** to:

```markdown
- `linkedin_ads.py` — LinkedIn API client (OAuth login, token refresh, local CSV pull).
- `build_data.py` — pulls every account in `accounts.json` → `site/data.json` (campaigns, ads, daily numbers per ad).
- `site/` — the static page: `metrics.js`, `insights.js`, `sheet.js` = calculations (unit-tested);
  `app.js` (state, header, tabs), `overview.js`, `ads.js`, `sheet-view.js`, `ui.js` = rendering. Chart.js from cdnjs.
- `.github/workflows/refresh.yml` — tests, pulls data, deploys. Runs every 3 h, on push, or via *Actions → Refresh dashboard → Run workflow*.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "README: v2 file layout"
```

- [ ] **Step 3: Ask the user to confirm the release**, then:

```bash
git checkout main && git merge --ff-only feat/v2 && git push origin main
gh run watch "$(gh run list -R beafb/linkedin-ads-dashboard --limit 1 --json databaseId -q '.[0].databaseId')" -R beafb/linkedin-ads-dashboard --exit-status
curl -s https://beafb.github.io/linkedin-ads-dashboard/data.json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['generatedAt'],len(d['ads']),len(d['daily']))"
```

Expected: run succeeds; live `data.json` has `ads`; open the live URL and repeat a short version of Task 5 Step 9 (each tab, both accounts).
