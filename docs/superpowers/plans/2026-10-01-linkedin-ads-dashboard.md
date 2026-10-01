# LinkedIn Ads Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public GitHub Pages dashboard of LinkedIn Ads lead performance and funnel for the 3CC and C2 ad accounts, rebuilt from the LinkedIn API every 3 hours by GitHub Actions.

**Architecture:** `linkedin_ads.py` (API client) is reused; `build_data.py` pulls each account in `accounts.json` and writes `site/data.json`; `site/` is a static page (`index.html` + `style.css` + `app.js` for DOM + `metrics.js` for pure aggregation) drawing charts with Chart.js. A workflow runs tests, builds data, and deploys `site/` as a Pages artifact — no data is committed.

**Tech Stack:** Python 3 stdlib only (urllib, unittest), vanilla JS ES modules, Chart.js 4.4.1 from cdnjs, Node `node:test` for JS tests, GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-10-01-linkedin-ads-dashboard-design.md`

## Global Constraints

- Python is stdlib-only: no `pip install` locally or in CI.
- LinkedIn API: base `https://api.linkedin.com/rest`, headers `LinkedIn-Version: 202609`, `X-Restli-Protocol-Version: 2.0.0`.
- Accounts: `547203257` label `3CC`; `515707132` label `C2`. One app (`LKDN_CLIENT_ID`) + one member login.
- Secrets never committed: `.env`, `.linkedin_tokens.json`, generated `site/data.json` and `data/` are gitignored.
- CI secrets: `LKDN_CLIENT_ID`, `LKDN_PRIMARY_CLIENT_SECRET`, `LKDN_REFRESH_TOKEN`, `LKDN_REFRESH_EXPIRES_AT`.
- Refresh: cron every 3 hours + `workflow_dispatch`.
- No dual-axis charts; one measure per chart. Untrusted strings (campaign/group names) go into the DOM via `textContent` only.
- Metric definitions: CTR = clicks ÷ impressions; CPC = spend ÷ clicks; CPM = spend ÷ impressions × 1000; CPL = spend ÷ leads; form completion = leads ÷ lead-form opens. Division by zero renders "—".
- Range presets: `7d`, `30d` (default), `month`, `lastmonth`, `ytd`, `all`. State lives in the URL hash (`#acc=3CC&range=30d&c=<campaignId>`).
- Repo is public at `beafb/linkedin-ads-dashboard`; creating it and setting secrets require explicit user confirmation.

## Review Focus

1. **An account/range with no activity** (e.g. C2 paused, or "last 7 days" before any campaign ran) must show zeros and "—", not NaN, "Infinity" or a crash. → Task 3 tests `totals([])` / `ratios` on zeros; Task 4 checks it in the browser.
2. **Spend arrives as a long decimal string** (`"107.5300000000000335346"`) and must become a number rounded to cents. → Task 2 test `test_daily_row_maps_fields`.
3. **Analytics rows for a campaign not in the campaign list** (deleted/archived) must still count, under a stub named by its id. → Task 2 test `test_orphan_campaign_gets_stub`.
4. **Days with no rows inside the selected range** must appear as zeros so daily charts don't silently skip dates. → Task 3 test `byDate fills missing days`.
5. **Expired or revoked refresh token in CI** must fail the run with a message pointing to the README re-login steps, not a bare stack trace. → Task 1 test `test_refresh_failure_points_to_readme`.

---

### Task 1: API client in the repo, refresh token from environment

**Files:**
- Create: `linkedin_ads.py` (copied from `../linkedin_ads.py`, then modified)
- Create: `tests/__init__.py` (empty), `tests/test_linkedin_ads.py`
- Local only (gitignored): copy `../.env` and `../.linkedin_tokens.json` into the repo root

**Interfaces:**
- Produces (used by Task 2): `load_env()`, `get(path: str, query: str) -> dict` (empty `query` means no `?`), `get_all(path: str, query: str) -> list[dict]`, `enc(urn: str) -> str`, `date_obj(d: date) -> str`, `access_token() -> str`, `refresh_access_token(refresh_token: str) -> str`.

- [ ] **Step 1: Copy files**

```bash
cd /Users/nicolasmonnier/Workplace/C2Cap/linkedin-ads-dashboard
cp ../linkedin_ads.py ../.env ../.linkedin_tokens.json .
mkdir -p tests && touch tests/__init__.py
git status --short   # must NOT list .env or .linkedin_tokens.json
```

- [ ] **Step 2: Write the failing tests** — `tests/test_linkedin_ads.py`

```python
import io, os, unittest, urllib.error
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import linkedin_ads as li


class RefreshTokenFromEnv(unittest.TestCase):
    def setUp(self):
        li._session_token = None
        self.env = mock.patch.dict(os.environ, {
            "LKDN_CLIENT_ID": "cid", "LKDN_PRIMARY_CLIENT_SECRET": "secret",
            "LKDN_REFRESH_TOKEN": "rt"}, clear=False)
        self.env.start()
        os.environ.pop("LKDN_ACCESS_TOKEN", None)

    def tearDown(self):
        self.env.stop()
        li._session_token = None

    def test_exchanges_once_and_writes_nothing(self):
        with TemporaryDirectory() as tmp, \
             mock.patch.object(li, "TOKEN_FILE", Path(tmp) / "tok.json"), \
             mock.patch.object(li, "post_form", return_value={"access_token": "abc"}) as pf:
            self.assertEqual(li.access_token(), "abc")
            self.assertEqual(li.access_token(), "abc")
            pf.assert_called_once()
            self.assertEqual(pf.call_args.args[1]["grant_type"], "refresh_token")
            self.assertEqual(pf.call_args.args[1]["refresh_token"], "rt")
            self.assertFalse((Path(tmp) / "tok.json").exists())

    def test_refresh_failure_points_to_readme(self):
        err = urllib.error.HTTPError("u", 400, "Bad", {}, io.BytesIO(b'{"error":"invalid_grant"}'))
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(SystemExit) as cm:
                li.access_token()
        self.assertIn("invalid_grant", str(cm.exception))
        self.assertIn("README", str(cm.exception))


class GetQueryString(unittest.TestCase):
    def test_empty_query_has_no_question_mark(self):
        seen = {}
        def fake_urlopen(req):
            seen["url"] = req.full_url
            return io.BytesIO(b"{}")
        with mock.patch.object(li, "access_token", return_value="t"), \
             mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
            li.get("/adAccounts/1", "")
        self.assertEqual(seen["url"], "https://api.linkedin.com/rest/adAccounts/1")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python3 -m unittest discover -s tests -t . -v`
Expected: FAIL/ERROR — `module 'linkedin_ads' has no attribute '_session_token'` and the URL test gets `.../adAccounts/1?`.

- [ ] **Step 4: Implement** — edit `linkedin_ads.py`

Update the module docstring env line to:

```python
Env (.env): LKDN_CLIENT_ID, LKDN_PRIMARY_CLIENT_SECRET,
            LKDN_ACCESS_TOKEN (optional, overrides everything),
            LKDN_REFRESH_TOKEN (optional, CI: exchanged in memory, nothing written to disk),
            LKDN_REDIRECT_URI (optional, default http://localhost:8765/callback)
```

Add below `SCOPES`:

```python
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
_session_token = None  # access token obtained from LKDN_REFRESH_TOKEN for this process
```

Replace `post_form` with:

```python
def post_form(url, data, hint=""):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Token request failed ({e.code}): {e.read().decode()} {hint}".rstrip())
```

Add before `access_token`:

```python
def refresh_access_token(refresh_token):
    tok = post_form(TOKEN_URL, {
        "grant_type": "refresh_token", "refresh_token": refresh_token,
        "client_id": os.environ["LKDN_CLIENT_ID"],
        "client_secret": os.environ["LKDN_PRIMARY_CLIENT_SECRET"]},
        hint="- refresh token rejected or expired: see README 'Yearly re-login'.")
    return tok["access_token"]
```

Replace the start of `access_token` (the `LKDN_ACCESS_TOKEN` branch stays first):

```python
def access_token():
    global _session_token
    if os.environ.get("LKDN_ACCESS_TOKEN"):  # manual token, e.g. from the portal's Token Generator
        return os.environ["LKDN_ACCESS_TOKEN"]
    if os.environ.get("LKDN_REFRESH_TOKEN"):  # CI: no token file, keep it in memory
        if not _session_token:
            _session_token = refresh_access_token(os.environ["LKDN_REFRESH_TOKEN"])
        return _session_token
    if not TOKEN_FILE.exists():
```

(rest of the function unchanged; also replace the two literal `"https://www.linkedin.com/oauth/v2/accessToken"` strings in `cmd_auth` and `access_token` with `TOKEN_URL`).

In `get`, replace the URL line:

```python
    url = f"{API}{path}" + (f"?{query}" if query else "")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m unittest discover -s tests -t . -v`
Expected: 3 tests OK.

- [ ] **Step 6: Smoke test against the real API**

Run: `python3 linkedin_ads.py accounts`
Expected: list includes `547203257 ... 3 Comma Capital` and `515707132 ... C2Capital`.

- [ ] **Step 7: Commit**

```bash
git add linkedin_ads.py tests/__init__.py tests/test_linkedin_ads.py
git commit -m "Add LinkedIn API client with in-memory refresh-token auth for CI"
```

---

### Task 2: `build_data.py` → `site/data.json`

**Files:**
- Create: `build_data.py`, `accounts.json`, `tests/test_build_data.py`

**Interfaces:**
- Consumes: `linkedin_ads.get`, `get_all`, `enc`, `date_obj`, `load_env` (Task 1).
- Produces: `site/data.json` with the shape below (consumed by Tasks 3–4). Python functions `daily_row(el) -> dict`, `campaign_entry(c, account_id, group_names) -> dict`, `earliest_start(campaigns, today) -> date`, `expiry_warning(expires_at: float, now: float) -> str | None`, `build_account(cfg, api, today) -> (account, campaigns, daily)`, `build(accounts_cfg, api, today, now_iso) -> dict`.

```json
{"generatedAt": "2026-10-01T14:05:00+00:00",
 "accounts": [{"id": 547203257, "label": "3CC", "name": "3 Comma Capital", "currency": "EUR"}],
 "campaigns": [{"id": 1, "accountId": 547203257, "name": "C2-like", "group": "LG-NMonnier-1307",
                "status": "ACTIVE", "objective": "LEAD_GENERATION", "dailyBudget": 100.0}],
 "daily": [{"date": "2026-09-30", "campaignId": 1, "impressions": 0, "clicks": 0, "landingPageClicks": 0,
            "spend": 0.0, "leadFormOpens": 0, "leads": 0, "engagements": 0}]}
```

- [ ] **Step 1: Create `accounts.json`**

```json
[
  {"id": 547203257, "label": "3CC"},
  {"id": 515707132, "label": "C2"}
]
```

- [ ] **Step 2: Write the failing tests** — `tests/test_build_data.py`

```python
import unittest
from datetime import date

import build_data as bd

ELEMENT = {
    "dateRange": {"start": {"year": 2026, "month": 4, "day": 6}, "end": {"year": 2026, "month": 4, "day": 6}},
    "pivotValues": ["urn:li:sponsoredCampaign:431685124"],
    "costInLocalCurrency": "107.5300000000000335346", "impressions": 13468, "clicks": 242,
    "landingPageClicks": 0, "oneClickLeadFormOpens": 223, "oneClickLeads": 23, "totalEngagements": 1118,
}
ORPHAN = {**ELEMENT, "pivotValues": ["urn:li:sponsoredCampaign:999"], "costInLocalCurrency": "1"}
CAMPAIGN = {
    "id": 431685124, "name": "C2-like", "campaignGroup": "urn:li:sponsoredCampaignGroup:7",
    "status": "ACTIVE", "objectiveType": "LEAD_GENERATION",
    "dailyBudget": {"currencyCode": "EUR", "amount": "100"},
    "runSchedule": {"start": 1775433600000},  # 2026-04-06T00:00:00Z
}


class FakeApi:
    def __init__(self):
        self.calls = []

    def get(self, path, query):
        self.calls.append((path, query))
        if path == "/adAccounts/1":
            return {"id": 1, "name": "Acme", "currency": "EUR"}
        if path == "/adAnalytics":
            return {"elements": [ELEMENT, ORPHAN]}
        raise AssertionError(path)

    def get_all(self, path, query):
        if path == "/adAccounts/1/adCampaignGroups":
            return [{"id": 7, "name": "Group A"}]
        if path == "/adAccounts/1/adCampaigns":
            return [CAMPAIGN]
        raise AssertionError(path)


class Mapping(unittest.TestCase):
    def test_daily_row_maps_fields(self):
        self.assertEqual(bd.daily_row(ELEMENT), {
            "date": "2026-04-06", "campaignId": 431685124, "impressions": 13468, "clicks": 242,
            "landingPageClicks": 0, "spend": 107.53, "leadFormOpens": 223, "leads": 23, "engagements": 1118})

    def test_daily_row_missing_metric_is_zero(self):
        el = {k: v for k, v in ELEMENT.items() if k != "oneClickLeads"}
        self.assertEqual(bd.daily_row(el)["leads"], 0)

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

    def test_expiry_warning(self):
        now = 1_000_000
        self.assertIsNone(bd.expiry_warning(now + 31 * 86400, now))
        self.assertIn("10 days", bd.expiry_warning(now + 10 * 86400, now))
        self.assertIn("0 days", bd.expiry_warning(now - 5, now))


class Build(unittest.TestCase):
    def test_build_account(self):
        api = FakeApi()
        account, campaigns, daily = bd.build_account({"id": 1, "label": "ACME"}, api, date(2026, 10, 1))
        self.assertEqual(account, {"id": 1, "label": "ACME", "name": "Acme", "currency": "EUR"})
        self.assertEqual(len(daily), 2)
        query = dict(api.calls)["/adAnalytics"]
        self.assertIn("pivot=CAMPAIGN", query)
        self.assertIn("timeGranularity=DAILY", query)
        self.assertIn("dateRange=(start:(year:2026,month:4,day:6),end:(year:2026,month:10,day:1))", query)
        self.assertIn("accounts=List(urn%3Ali%3AsponsoredAccount%3A1)", query)
        self.assertIn("oneClickLeads", query)

    def test_orphan_campaign_gets_stub(self):
        _, campaigns, _ = bd.build_account({"id": 1, "label": "ACME"}, FakeApi(), date(2026, 10, 1))
        stub = [c for c in campaigns if c["id"] == 999]
        self.assertEqual(stub, [{"id": 999, "accountId": 1, "name": "999", "group": "", "status": "UNKNOWN",
                                 "objective": "", "dailyBudget": None}])

    def test_build_merges_and_sorts(self):
        out = bd.build([{"id": 1, "label": "ACME"}], FakeApi(), date(2026, 10, 1), "2026-10-01T00:00:00+00:00")
        self.assertEqual(out["generatedAt"], "2026-10-01T00:00:00+00:00")
        self.assertEqual([a["label"] for a in out["accounts"]], ["ACME"])
        self.assertEqual([r["campaignId"] for r in out["daily"]], [999, 431685124])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python3 -m unittest discover -s tests -t . -v`
Expected: ERROR `ModuleNotFoundError: No module named 'build_data'`.

- [ ] **Step 4: Implement `build_data.py`**

```python
#!/usr/bin/env python3
"""Pull every ad account in accounts.json and write site/data.json for the dashboard.

Usage: python3 build_data.py
Auth comes from linkedin_ads.py (.env / .linkedin_tokens.json locally, LKDN_REFRESH_TOKEN in CI).
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


def urn_id(urn):
    return int(urn.rsplit(":", 1)[-1])


def daily_row(el):
    d = el["dateRange"]["start"]
    row = {"date": f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}",
           "campaignId": urn_id(el["pivotValues"][0])}
    for key, field in METRIC_MAP.items():
        value = el.get(field, 0)
        row[key] = round(float(value), 2) if key == "spend" else int(value)
    return row


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
    return min(datetime.fromtimestamp(min(starts) / 1000, timezone.utc).date(), today)


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
    since = earliest_start(camps, today)
    elements = api.get("/adAnalytics", "&".join([
        "q=analytics", "pivot=CAMPAIGN", "timeGranularity=DAILY",
        f"dateRange=(start:{li.date_obj(since)},end:{li.date_obj(today)})",
        f"accounts=List({li.enc(f'urn:li:sponsoredAccount:{aid}')})",
        "fields=" + ",".join(FIELDS)])).get("elements", [])

    group_names = {f"urn:li:sponsoredCampaignGroup:{g['id']}": g.get("name", "") for g in groups}
    campaigns = [campaign_entry(c, aid, group_names) for c in camps]
    daily = [daily_row(el) for el in elements]
    known = {c["id"] for c in campaigns}
    for cid in sorted({r["campaignId"] for r in daily} - known):  # deleted/archived campaigns
        campaigns.append({"id": cid, "accountId": aid, "name": str(cid), "group": "",
                          "status": "UNKNOWN", "objective": "", "dailyBudget": None})
    account = {"id": aid, "label": cfg["label"], "name": acc.get("name", ""),
               "currency": acc.get("currency", "")}
    return account, campaigns, daily


def build(accounts_cfg, api, today, now_iso):
    out = {"generatedAt": now_iso, "accounts": [], "campaigns": [], "daily": []}
    for cfg in accounts_cfg:
        account, campaigns, daily = build_account(cfg, api, today)
        out["accounts"].append(account)
        out["campaigns"] += campaigns
        out["daily"] += daily
    out["daily"].sort(key=lambda r: (r["date"], r["campaignId"]))
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
        n = sum(1 for c in data["campaigns"] if c["accountId"] == a["id"])
        print(f"{a['label']}: {a['name']} ({a['currency']}), {n} campaigns")
    print(f"{len(data['daily'])} daily rows -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m unittest discover -s tests -t . -v`
Expected: all tests OK (3 from Task 1 + 10 here).

- [ ] **Step 6: Real run**

Run: `python3 build_data.py`
Expected: lines for `3CC: 3 Comma Capital (EUR)` and `C2: C2Capital (EUR)`, a daily row count > 200, and `site/data.json` exists. Check: `python3 -c "import json;d=json.load(open('site/data.json'));print(d['daily'][-1])"` prints a row with today's or yesterday's date.

- [ ] **Step 7: Commit**

```bash
git status --short   # site/data.json must NOT appear (gitignored)
git add build_data.py accounts.json tests/test_build_data.py
git commit -m "Add data build: all accounts to site/data.json"
```

---

### Task 3: `site/metrics.js` — pure aggregation

**Files:**
- Create: `site/metrics.js`, `tests/metrics.test.mjs`

**Interfaces:**
- Consumes: `data.json` `daily` rows (Task 2 shape).
- Produces (used by Task 4): `SUM_KEYS`, `toDate(iso)`, `addDays(iso, n)`, `todayIso()`, `rangeFor(preset, today, firstDate) -> {start, end}`, `previousRange({start,end}) -> {start,end}`, `filterRows(daily, {start,end}, campaignIds: Set<number>) -> rows`, `totals(rows) -> {impressions, clicks, landingPageClicks, spend, leadFormOpens, leads, engagements}`, `ratios(t) -> {cpl, ctr, cpc, cpm, formRate, clickToForm}` (each `number|null`), `delta(cur, prev) -> number|null`, `byDate(rows, {start,end}) -> [{date, ...totals}]`, `byCampaign(rows) -> Map<campaignId, totals>`. All dates are `YYYY-MM-DD` strings.

- [ ] **Step 1: Write the failing tests** — `tests/metrics.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../site/metrics.js";

const row = (date, campaignId, o = {}) => ({ date, campaignId, impressions: 0, clicks: 0, landingPageClicks: 0,
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

test("filterRows by date and campaign", () => {
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

test("byCampaign groups totals", () => {
  const got = M.byCampaign([row("2026-09-30", 1, { spend: 1 }), row("2026-10-01", 1, { spend: 2 }), row("2026-10-01", 2, { spend: 5 })]);
  assert.equal(got.get(1).spend, 3);
  assert.equal(got.get(2).spend, 5);
});

test("todayIso is YYYY-MM-DD", () => {
  assert.match(M.todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/`
Expected: FAIL — `Cannot find module '.../site/metrics.js'`.

- [ ] **Step 3: Implement `site/metrics.js`**

```js
// Pure aggregation helpers for the dashboard. No DOM access, tested with `node --test tests/`.
// Dates are "YYYY-MM-DD" strings in the ad account's reporting day.

export const SUM_KEYS = ["impressions", "clicks", "landingPageClicks", "spend", "leadFormOpens", "leads", "engagements"];

const DAY_MS = 86400000;
export const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * DAY_MS));
const daysInclusive = (start, end) => Math.round((toDate(end) - toDate(start)) / DAY_MS) + 1;
export const todayIso = () => new Date().toLocaleDateString("en-CA");  // local date, YYYY-MM-DD

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

export function filterRows(daily, { start, end }, campaignIds) {
  return daily.filter((r) => r.date >= start && r.date <= end && campaignIds.has(r.campaignId));
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

export function byCampaign(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.campaignId)) groups.set(r.campaignId, []);
    groups.get(r.campaignId).push(r);
  }
  return new Map([...groups].map(([id, rs]) => [id, totals(rs)]));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add site/metrics.js tests/metrics.test.mjs
git commit -m "Add dashboard metric aggregation with tests"
```

---

### Task 4: Dashboard page (`index.html`, `style.css`, `app.js`)

**Files:**
- Create: `site/index.html`, `site/style.css`, `site/app.js`

**Interfaces:**
- Consumes: `site/data.json` (Task 2), all exports of `site/metrics.js` (Task 3), global `Chart` from `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`.
- Produces: the published page.

- [ ] **Step 1: `site/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LinkedIn Ads Dashboard</title>
  <link rel="stylesheet" href="style.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
  <script type="module" src="app.js"></script>
</head>
<body>
  <header class="top">
    <div class="title">
      <h1>LinkedIn Ads</h1>
      <p id="updated" class="muted"></p>
    </div>
    <div class="filters">
      <div id="accounts" class="seg" role="group" aria-label="Account"></div>
      <label class="range">Period
        <select id="range">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
          <option value="lastmonth">Last month</option>
          <option value="ytd">Year to date</option>
          <option value="all">All time</option>
        </select>
      </label>
      <button id="campaign-chip" class="chip" type="button" hidden></button>
    </div>
  </header>
  <main>
    <p id="error" class="error" role="alert" hidden></p>
    <section>
      <h2>Lead performance</h2>
      <div id="lead-kpis" class="kpis"></div>
      <div class="charts">
        <figure class="card"><figcaption>Leads per day</figcaption><div class="plot"><canvas id="chart-leads" role="img" aria-label="Leads per day"></canvas></div></figure>
        <figure class="card"><figcaption>Cost per lead</figcaption><div class="plot"><canvas id="chart-cpl" role="img" aria-label="Cost per lead per day"></canvas></div></figure>
      </div>
    </section>
    <section>
      <h2>Funnel</h2>
      <ol id="funnel" class="funnel"></ol>
      <div id="funnel-kpis" class="kpis"></div>
      <div class="charts">
        <figure class="card"><figcaption>Impressions per day</figcaption><div class="plot"><canvas id="chart-impressions" role="img" aria-label="Impressions per day"></canvas></div></figure>
        <figure class="card"><figcaption>Clicks per day</figcaption><div class="plot"><canvas id="chart-clicks" role="img" aria-label="Clicks per day"></canvas></div></figure>
      </div>
    </section>
    <section>
      <h2>Campaigns</h2>
      <div class="table-wrap"><table id="campaigns"><thead></thead><tbody></tbody></table></div>
      <p id="no-campaigns" class="muted" hidden>No campaign activity in this period.</p>
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
  --bad: #c4312f;
  --accent-bg: #e8f1fc;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19;
    --surface-2: #232322;
    --border: #3a3a37;
    --grid: #2e2e2c;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #9b9a92;
    --series-1: #3987e5;
    --good: #4cc38a;
    --bad: #f07272;
    --accent-bg: #1c2f48;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19;
  --surface-2: #232322;
  --border: #3a3a37;
  --grid: #2e2e2c;
  --text-primary: #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted: #9b9a92;
  --series-1: #3987e5;
  --good: #4cc38a;
  --bad: #f07272;
  --accent-bg: #1c2f48;
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--surface); color: var(--text-primary);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.top, main { max-width: 1120px; margin: 0 auto; padding: 0 16px; }
.top { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: end; justify-content: space-between; padding-top: 24px; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 16px; margin: 32px 0 12px; color: var(--text-secondary); font-weight: 600; }
.muted { color: var(--text-muted); margin: 2px 0 0; font-size: 13px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.seg button { border: 0; background: var(--surface-2); color: var(--text-secondary); padding: 6px 12px; font: inherit; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--border); }
.seg button[aria-pressed="true"] { background: var(--accent-bg); color: var(--text-primary); font-weight: 600; }
.range { display: inline-flex; gap: 6px; align-items: center; color: var(--text-secondary); font-size: 13px; }
select, .chip { font: inherit; color: var(--text-primary); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; }
.chip { cursor: pointer; background: var(--accent-bg); }
.error { background: var(--surface-2); border: 1px solid var(--bad); color: var(--text-primary); border-radius: 8px; padding: 12px; margin-top: 16px; }

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.kpi { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.kpi-label { color: var(--text-secondary); font-size: 13px; }
.kpi-value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; margin: 2px 0; }
.kpi-delta { font-size: 12px; color: var(--text-muted); }
.kpi-delta.good { color: var(--good); }
.kpi-delta.bad { color: var(--bad); }

.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-top: 12px; }
.card { margin: 0; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; min-width: 0; }
.card figcaption { color: var(--text-secondary); font-size: 13px; margin-bottom: 8px; }
.plot { position: relative; height: 200px; }

.funnel { list-style: none; padding: 0; margin: 0 0 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.funnel li { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.funnel .step { color: var(--text-secondary); font-size: 13px; }
.funnel .value { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.funnel .rate { font-size: 12px; color: var(--text-muted); }

.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); }
table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
th:nth-child(-n+3), td:nth-child(-n+3) { text-align: left; }
td:first-child { white-space: normal; min-width: 160px; }
thead th { position: sticky; top: 0; background: var(--surface-2); }
th button { all: unset; cursor: pointer; color: var(--text-secondary); font-weight: 600; }
th[aria-sort] button { color: var(--text-primary); }
tbody tr { cursor: pointer; }
tbody tr:hover, tbody tr:focus-visible { background: var(--accent-bg); outline: none; }
tbody tr:last-child td { border-bottom: 0; }
main { padding-bottom: 48px; }
```

- [ ] **Step 3: `site/app.js`**

```js
import * as M from "./metrics.js";

const RANGES = ["7d", "30d", "month", "lastmonth", "ytd", "all"];
const state = { account: "all", range: "30d", campaign: null, sortKey: "spend", sortDir: -1 };
let data = null;
const charts = {};
const $ = (id) => document.getElementById(id);

const DASH = "—";
const num = new Intl.NumberFormat("en-IE");
const pct = new Intl.NumberFormat("en-IE", { style: "percent", maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-IE", { notation: "compact" });
let money = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const fmtNum = (v) => (v == null ? DASH : num.format(Math.round(v)));
const fmtMoney = (v) => (v == null ? DASH : money.format(v));
const fmtPct = (v) => (v == null ? DASH : pct.format(v));
const fmtDay = (iso) => M.toDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const titleCase = (s) => (s ? s[0] + s.slice(1).toLowerCase() : "");
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("acc")) state.account = p.get("acc");
  if (RANGES.includes(p.get("range"))) state.range = p.get("range");
  state.campaign = p.get("c") ? Number(p.get("c")) : null;
}

function writeHash() {
  const p = new URLSearchParams({ acc: state.account, range: state.range });
  if (state.campaign) p.set("c", state.campaign);
  history.replaceState(null, "", `#${p}`);
}

const selectedAccounts = () =>
  state.account === "all" ? data.accounts : data.accounts.filter((a) => a.label === state.account);

function selectedCampaignIds() {
  const accIds = new Set(selectedAccounts().map((a) => a.id));
  const ids = data.campaigns.filter((c) => accIds.has(c.accountId)).map((c) => c.id);
  return new Set(state.campaign && ids.includes(state.campaign) ? [state.campaign] : ids);
}

function update() {
  writeHash();
  render();
}

function renderControls() {
  const labels = data.accounts.map((a) => a.label);
  if (labels.length > 1) labels.push("all");
  $("accounts").replaceChildren(...labels.map((label) => {
    const b = el("button", null, label === "all" ? (data.accounts.length === 2 ? "Both" : "All") : label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(state.account === label));
    b.onclick = () => { state.account = label; state.campaign = null; update(); };
    return b;
  }));
  $("range").value = state.range;
  const c = state.campaign && data.campaigns.find((x) => x.id === state.campaign);
  $("campaign-chip").hidden = !c;
  if (c) $("campaign-chip").textContent = `Campaign: ${c.name} ✕`;
}

function renderKpis(container, items) {
  container.replaceChildren(...items.map(({ label, value, d, good }) => {
    const tile = el("div", "kpi");
    const delta = el("div", "kpi-delta");
    if (d == null) {
      delta.textContent = "no comparison";
    } else {
      const up = d >= 0;
      delta.textContent = `${up ? "▲" : "▼"} ${pct.format(Math.abs(d))} vs previous period`;
      if (good) delta.classList.add(up === (good === "up") ? "good" : "bad");
    }
    tile.append(el("div", "kpi-label", label), el("div", "kpi-value", value), delta);
    return tile;
  }));
}

function renderFunnel(t, r) {
  const steps = [
    ["Impressions", t.impressions, null],
    ["Clicks", t.clicks, r.ctr],
    ["Lead-form opens", t.leadFormOpens, r.clickToForm],
    ["Leads", t.leads, r.formRate],
  ];
  $("funnel").replaceChildren(...steps.map(([label, value, rate]) => {
    const li = el("li");
    li.append(el("div", "step", label), el("div", "value", fmtNum(value)),
      el("div", "rate", rate == null && label === "Impressions" ? " " : `${fmtPct(rate)} of previous step`));
    return li;
  }));
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawChart(id, type, labels, values, fmt) {
  charts[id]?.destroy();
  const series = cssVar("--series-1");
  const muted = cssVar("--text-muted");
  const grid = cssVar("--grid");
  charts[id] = new Chart($(id), {
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
             ticks: { color: muted, maxTicksLimit: 5, callback: (v) => compact.format(v) } },
      },
    },
  });
}

const COLS = [
  { key: "name", label: "Campaign" },
  { key: "group", label: "Group" },
  { key: "status", label: "Status" },
  { key: "dailyBudget", label: "Daily budget", fmt: (v) => fmtMoney(v) },
  { key: "impressions", label: "Impressions", fmt: fmtNum },
  { key: "clicks", label: "Clicks", fmt: fmtNum },
  { key: "ctr", label: "CTR", fmt: fmtPct },
  { key: "spend", label: "Spend", fmt: fmtMoney },
  { key: "leads", label: "Leads", fmt: fmtNum },
  { key: "cpl", label: "CPL", fmt: fmtMoney },
];

function renderTable(rows) {
  const byC = M.byCampaign(rows);
  const list = data.campaigns
    .filter((c) => (byC.get(c.id)?.impressions || 0) > 0)
    .map((c) => {
      const t = byC.get(c.id);
      return { ...c, ...t, ...M.ratios(t), status: titleCase(c.status) };
    });
  const { sortKey: k, sortDir: dir } = state;
  list.sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
  });

  const head = el("tr");
  for (const col of COLS) {
    const th = el("th");
    th.scope = "col";
    if (col.key === k) th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
    const b = el("button", null, col.label + (col.key === k ? (dir < 0 ? " ↓" : " ↑") : ""));
    b.type = "button";
    b.onclick = () => {
      state.sortDir = state.sortKey === col.key ? -state.sortDir : (col.fmt ? -1 : 1);
      state.sortKey = col.key;
      render();
    };
    th.append(b);
    head.append(th);
  }
  $("campaigns").tHead.replaceChildren(head);

  $("campaigns").tBodies[0].replaceChildren(...list.map((c) => {
    const tr = el("tr");
    tr.tabIndex = 0;
    tr.title = state.campaign === c.id ? "Click to show all campaigns" : "Click to filter the page to this campaign";
    const toggle = () => { state.campaign = state.campaign === c.id ? null : c.id; update(); };
    tr.onclick = toggle;
    tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
    for (const col of COLS) tr.append(el("td", null, col.fmt ? col.fmt(c[col.key]) : c[col.key] || DASH));
    return tr;
  }));
  $("no-campaigns").hidden = list.length > 0;
}

function render() {
  const today = M.todayIso();
  const firstDate = data.daily.length ? data.daily[0].date : today;
  const range = M.rangeFor(state.range, today, firstDate);
  const ids = selectedCampaignIds();
  const rows = M.filterRows(data.daily, range, ids);
  const cur = M.totals(rows);
  const prev = M.totals(M.filterRows(data.daily, M.previousRange(range), ids));
  const r = M.ratios(cur);
  const pr = M.ratios(prev);
  money = new Intl.NumberFormat("en-IE", { style: "currency", currency: selectedAccounts()[0]?.currency || "EUR" });

  renderControls();
  renderKpis($("lead-kpis"), [
    { label: "Leads", value: fmtNum(cur.leads), d: M.delta(cur.leads, prev.leads), good: "up" },
    { label: "Cost per lead", value: fmtMoney(r.cpl), d: M.delta(r.cpl, pr.cpl), good: "down" },
    { label: "Spend", value: fmtMoney(cur.spend), d: M.delta(cur.spend, prev.spend), good: null },
    { label: "Form completion", value: fmtPct(r.formRate), d: M.delta(r.formRate, pr.formRate), good: "up" },
  ]);
  renderFunnel(cur, r);
  renderKpis($("funnel-kpis"), [
    { label: "Click-through rate", value: fmtPct(r.ctr), d: M.delta(r.ctr, pr.ctr), good: "up" },
    { label: "Cost per click", value: fmtMoney(r.cpc), d: M.delta(r.cpc, pr.cpc), good: "down" },
    { label: "Cost per 1,000 impressions", value: fmtMoney(r.cpm), d: M.delta(r.cpm, pr.cpm), good: "down" },
  ]);

  const days = M.byDate(rows, range);
  const labels = days.map((d) => fmtDay(d.date));
  drawChart("chart-leads", "bar", labels, days.map((d) => d.leads), fmtNum);
  drawChart("chart-cpl", "line", labels, days.map((d) => (d.leads ? d.spend / d.leads : null)), fmtMoney);
  drawChart("chart-impressions", "line", labels, days.map((d) => d.impressions), fmtNum);
  drawChart("chart-clicks", "bar", labels, days.map((d) => d.clicks), fmtNum);
  renderTable(rows);
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
    return;
  }
  const labels = data.accounts.map((a) => a.label);
  if (labels.length === 1) state.account = labels[0];
  else if (!labels.includes(state.account)) state.account = "all";
  $("updated").textContent = `Last updated ${new Date(data.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;
  $("range").onchange = (e) => { state.range = e.target.value; update(); };
  $("campaign-chip").onclick = () => { state.campaign = null; update(); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  update();
}

init();
```

- [ ] **Step 4: Check it in a browser**

```bash
python3 build_data.py            # fresh site/data.json if older than today
python3 -m http.server 8000 -d site
```

Open `http://localhost:8000` (claude-in-chrome or manually) and verify:
- 3CC, C2, Both each change the numbers; Both = 3CC + C2 for leads and spend.
- Every range preset works; "Last 7 days" on an account with no activity shows 0 / "—" and no console errors.
- Clicking a campaign row filters KPIs/charts and shows the chip; the chip clears it.
- Sorting by each column header works; the arrow shows the direction.
- Reload keeps the view (URL hash).
- Dark mode (toggle OS appearance) recolors charts; phone width (≈390px) has no horizontal page scroll (the table scrolls inside its box).
- Temporarily rename `site/data.json` → reload shows the red error box; rename back.
- Compare the 3CC "All time" leads and spend to the earlier CSV totals (C2-like 298 leads / €4,632.77 etc. through 2026-09-30).

- [ ] **Step 5: Commit**

```bash
git add site/index.html site/style.css site/app.js
git commit -m "Add dashboard page: lead KPIs, funnel, daily charts, campaign table"
```

---

### Task 5: Workflow and README

**Files:**
- Create: `.github/workflows/refresh.yml`, `README.md`

**Interfaces:**
- Consumes: `build_data.py` (Task 2), tests (Tasks 1–3), `site/` (Tasks 3–4), CI secrets.

- [ ] **Step 1: `.github/workflows/refresh.yml`**

```yaml
name: Refresh dashboard

on:
  schedule:
    - cron: "17 */3 * * *"   # every 3 hours (UTC)
  workflow_dispatch:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write
  actions: write   # re-enable this workflow each run (GitHub disables cron after 60 idle days)

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Tests
        run: |
          python -m unittest discover -s tests -t . -v
          node --test tests/
      - name: Pull LinkedIn data
        run: python build_data.py
        env:
          LKDN_CLIENT_ID: ${{ secrets.LKDN_CLIENT_ID }}
          LKDN_PRIMARY_CLIENT_SECRET: ${{ secrets.LKDN_PRIMARY_CLIENT_SECRET }}
          LKDN_REFRESH_TOKEN: ${{ secrets.LKDN_REFRESH_TOKEN }}
          LKDN_REFRESH_EXPIRES_AT: ${{ secrets.LKDN_REFRESH_EXPIRES_AT }}
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - name: Keep the schedule alive
        if: github.event_name == 'schedule'
        run: gh api -X PUT "repos/${{ github.repository }}/actions/workflows/refresh.yml/enable"
        env:
          GH_TOKEN: ${{ github.token }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate YAML parses**

Run: `ruby -ryaml -e 'y=YAML.load_file(".github/workflows/refresh.yml"); puts y["jobs"].keys.inspect'`
Expected: `["build", "deploy"]`

- [ ] **Step 3: `README.md`**

````markdown
# LinkedIn Ads Dashboard

Public dashboard of LinkedIn Ads lead performance for the 3CC and C2 ad accounts.
GitHub Actions pulls the LinkedIn Marketing API every 3 hours and publishes `site/` to GitHub Pages.

## How it works

- `linkedin_ads.py` — LinkedIn API client (OAuth login, token refresh, local CSV pull).
- `build_data.py` — pulls every account in `accounts.json` → `site/data.json`.
- `site/` — the static page (`metrics.js` = calculations, `app.js` = rendering, Chart.js from cdnjs).
- `.github/workflows/refresh.yml` — tests, pulls data, deploys. Runs every 3 h, on push, or via *Actions → Refresh dashboard → Run workflow*.

## Local development

```bash
# .env needs LKDN_CLIENT_ID and LKDN_PRIMARY_CLIENT_SECRET
python3 linkedin_ads.py auth        # once: browser login, saves .linkedin_tokens.json
python3 build_data.py               # writes site/data.json
python3 -m http.server 8000 -d site # open http://localhost:8000
python3 -m unittest discover -s tests -t . && node --test tests/
```

The LinkedIn app must list `http://localhost:8765/callback` under *Auth → Authorized redirect URLs*.

## Adding an ad account

Add `{"id": <account id>, "label": "<short name>"}` to `accounts.json` and push.
`python3 linkedin_ads.py accounts` lists the IDs the login can see.

## GitHub secrets

| Secret | Value |
|---|---|
| `LKDN_CLIENT_ID` | app client ID |
| `LKDN_PRIMARY_CLIENT_SECRET` | app client secret |
| `LKDN_REFRESH_TOKEN` | `refresh_token` from `.linkedin_tokens.json` |
| `LKDN_REFRESH_EXPIRES_AT` | `refresh_expires_at` from `.linkedin_tokens.json` (unix time) |

## Yearly re-login

LinkedIn refresh tokens last 365 days from the login and are not extended by use.
About 30 days before expiry the workflow shows a warning; after expiry runs fail with
"refresh token rejected or expired". To renew:

```bash
python3 linkedin_ads.py auth
python3 -c "import json;print(json.load(open('.linkedin_tokens.json'))['refresh_token'],end='')" | gh secret set LKDN_REFRESH_TOKEN
python3 -c "import json;print(json.load(open('.linkedin_tokens.json'))['refresh_expires_at'],end='')" | gh secret set LKDN_REFRESH_EXPIRES_AT
gh workflow run refresh.yml
```

## Privacy

This site is public: anyone with the URL sees spend, leads and campaign names. Lead contact
details are never pulled or published.
````

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/refresh.yml README.md
git commit -m "Add scheduled refresh workflow and README"
```

---

### Task 6: Publish (requires user confirmation before each outward-facing step)

**Files:** none (GitHub configuration)

- [ ] **Step 1: Confirm with the user**, then create the public repo and push

```bash
gh repo create beafb/linkedin-ads-dashboard --public --source . --remote origin
git push -u origin main
```

(The push triggers a run that fails at "Pull LinkedIn data" until secrets exist — expected.)

- [ ] **Step 2: Set secrets without printing them**

```bash
grep '^LKDN_CLIENT_ID=' .env | cut -d= -f2- | tr -d '\n' | gh secret set LKDN_CLIENT_ID
grep '^LKDN_PRIMARY_CLIENT_SECRET=' .env | cut -d= -f2- | tr -d '\n' | gh secret set LKDN_PRIMARY_CLIENT_SECRET
python3 -c "import json;print(json.load(open('.linkedin_tokens.json'))['refresh_token'],end='')" | gh secret set LKDN_REFRESH_TOKEN
python3 -c "import json;print(json.load(open('.linkedin_tokens.json'))['refresh_expires_at'],end='')" | gh secret set LKDN_REFRESH_EXPIRES_AT
gh secret list
```

Expected: 4 secrets listed.

- [ ] **Step 3: Enable Pages from Actions**

```bash
gh api -X POST repos/beafb/linkedin-ads-dashboard/pages -f build_type=workflow
```

Expected: JSON with `"html_url": "https://beafb.github.io/linkedin-ads-dashboard/"`.

- [ ] **Step 4: Run and verify**

```bash
gh workflow run refresh.yml
sleep 5; gh run watch "$(gh run list --workflow refresh.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
curl -s https://beafb.github.io/linkedin-ads-dashboard/data.json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['generatedAt'],[a['label'] for a in d['accounts']],len(d['daily']))"
```

Expected: run succeeds; curl prints a fresh `generatedAt`, `['3CC', 'C2']`, and the same row count as the local build. Open the URL in a browser and repeat the Task 4 Step 4 spot checks.
