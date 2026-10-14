# Lead Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, per account/campaign/ad and period, how many LinkedIn leads the ads created and where each stands today in Brevo — on the Overview and in a new Leads tab — publishing aggregates only.

**Architecture:** `brevo.py` (Brevo client) and `lead_status.py` (Lead Sync fetch + email join + aggregation) are pure-ish modules with injected fetchers; `build_data.py` adds `leadStatus` rows `{date, accountId, campaignId, adId, status, count, unsubscribed}` to `site/data.json`. Front-end: pure `site/leads.js` (filters, totals, funnel, sentence, weekly series, table) + `site/leads-view.js` (DOM); Overview gains a sentence, funnel strip and warning card.

**Tech Stack:** Python 3 stdlib, vanilla JS ES modules, Chart.js 4.4.1, `node:test`, GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-10-14-lead-status-design.md` (builds on `2026-10-01-dashboard-v2-design.md`)

## Global Constraints

- No personal data in `site/data.json`, logs or the repo: no emails (plain or hashed), names, phones, answers.
- Statuses, exact strings and order: `Not in Brevo`, `In Brevo, no deal`, `Cold`, `Warm`, `Hot`, `Won`, `Lost`. Deal precedence Won > Hot > Warm > Cold > Lost.
- Test leads (`testLead: true`) excluded. Lead date = `submittedAt` as UTC date.
- Email join: lower-cased, trimmed; email = answer to the form question with `predefinedField == "EMAIL"`.
- Brevo key from env `BREVO_API_KEY` (loaded from `.env` by `linkedin_ads.load_env()` locally; secret in CI); never printed.
- Python stdlib only; tests never hit the network.
- Test commands: `python3 -m unittest discover -s tests -t .` and `node --test tests/*.test.mjs`.
- Status colours: ordinal blue ramp `--st-0`…`--st-5` (Not in Brevo → Won), `--st-lost` neutral gray; validate with the dataviz validator.
- Setting GitHub secrets and pushing to `main` require explicit user confirmation.

## Review Focus

1. **Lead whose email matches no Brevo contact, or has no email answer** must count as "Not in Brevo", never crash or be dropped. → Task 2 `test_aggregate_statuses`.
2. **Contact with several deals including Lost** must show the most advanced non-Lost stage (Warm beats Lost). → Task 2 `test_deal_stage_precedence`.
3. **Leads without campaign/ad** (4 today) must appear in account totals and as "Unknown campaign/ad" rows, and disappear when a campaign filter is set. → Task 4 `filterLeadRows`/`leadTable` tests.
4. **Any personal data in the output** — the aggregate serialised must contain no "@" nor answer text. → Task 2 `test_aggregate_has_no_personal_data`.
5. **Brevo/LinkedIn error messages** must never contain the API key. → Task 1 `test_error_message_hides_key`.

---

### Task 1: `brevo.py` — Brevo client

**Files:** Create `brevo.py`, `tests/test_brevo.py`

**Interfaces:**
- Produces: `load_key() -> str`, `get(path, key, opener=urllib.request.urlopen) -> dict`, `contacts(fetch) -> list`, `deals(fetch) -> list`, `stages(fetch) -> {stage_id: name}` where `fetch(path) -> dict`.

- [ ] **Step 1: Write `tests/test_brevo.py`**

```python
import io, os, unittest, urllib.error
from unittest import mock

import brevo


class Paging(unittest.TestCase):
    def test_contacts_pages_by_1000(self):
        calls = []
        def fetch(path):
            calls.append(path)
            return {"count": 1500, "contacts": [{"id": len(calls)}] * (1000 if len(calls) == 1 else 500)}
        self.assertEqual(len(brevo.contacts(fetch)), 1500)
        self.assertEqual(calls, ["/contacts?limit=1000&offset=0", "/contacts?limit=1000&offset=1000"])

    def test_deals_pages_until_short_page(self):
        calls = []
        def fetch(path):
            calls.append(path)
            return {"items": [{}] * (500 if len(calls) == 1 else 2)}
        self.assertEqual(len(brevo.deals(fetch)), 502)
        self.assertEqual(calls, ["/crm/deals?limit=500&offset=0", "/crm/deals?limit=500&offset=500"])

    def test_stages_flatten_all_pipelines(self):
        fetch = lambda path: [{"stages": [{"id": "a", "name": "Cold"}]}, {"stages": [{"id": "b", "name": "Won"}]}]
        self.assertEqual(brevo.stages(fetch), {"a": "Cold", "b": "Won"})


class Key(unittest.TestCase):
    def test_missing_key_mentions_ci_secret(self):
        with mock.patch.dict(os.environ, {}, clear=True), self.assertRaises(SystemExit) as cm:
            brevo.load_key()
        self.assertIn("repository secret", str(cm.exception))

    def test_error_message_hides_key(self):
        err = urllib.error.HTTPError("u", 401, "Unauthorized", {}, io.BytesIO(b'{"message":"Key not found"}'))
        def opener(req, timeout):
            raise err
        with self.assertRaises(SystemExit) as cm:
            brevo.get("/contacts?limit=1", "xkeysib-SECRET123", opener=opener)
        self.assertIn("401", str(cm.exception))
        self.assertNotIn("SECRET123", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run** `python3 -m unittest discover -s tests -t .` — Expected: ERROR `No module named 'brevo'`.

- [ ] **Step 3: Write `brevo.py`**

```python
#!/usr/bin/env python3
"""Brevo (CRM) API client: contacts, deals and pipeline stages.

The key comes from BREVO_API_KEY (.env locally via linkedin_ads.load_env(), repository secret in CI).
List helpers take a `fetch(path) -> dict` callable so they can be tested without the network.
"""
import json, os, sys, time, urllib.error, urllib.request

API = "https://api.brevo.com/v3"


def load_key():
    key = os.environ.get("BREVO_API_KEY")
    if not key:
        sys.exit("Missing BREVO_API_KEY (.env locally, repository secret in CI)")
    return key


def get(path, key, opener=urllib.request.urlopen):
    req = urllib.request.Request(API + path, headers={"api-key": key, "accept": "application/json"})
    for attempt in range(4):
        try:
            with opener(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(2 ** attempt * 5)
                continue
            sys.exit(f"Brevo GET {path.split('?')[0]} failed ({e.code}): {e.read().decode()[:200]}")


def contacts(fetch):
    out, offset = [], 0
    while True:
        r = fetch(f"/contacts?limit=1000&offset={offset}")
        out += r.get("contacts", [])
        offset += 1000
        if offset >= r.get("count", 0):
            return out


def deals(fetch):
    out, offset = [], 0
    while True:
        items = fetch(f"/crm/deals?limit=500&offset={offset}").get("items", [])
        out += items
        offset += 500
        if len(items) < 500:
            return out


def stages(fetch):
    return {s["id"]: s["name"] for p in fetch("/crm/pipeline/details/all") for s in p.get("stages", [])}
```

- [ ] **Step 4: Run** tests — Expected: OK (all suites).

- [ ] **Step 5: Commit** `git add brevo.py tests/test_brevo.py && git commit -m "Add Brevo client (contacts, deals, stages)"`

---

### Task 2: `lead_status.py` — fetch, join, aggregate

**Files:** Create `lead_status.py`, `tests/test_lead_status.py`

**Interfaces:**
- Consumes: a LinkedIn getter `lk_get(path, query) -> dict` and `enc(urn) -> str` (from `linkedin_ads`).
- Produces: `STATUSES`, `form_id(lead) -> str|None`, `fetch_leads(lk_get, enc, account_id) -> list`, `email_question_ids(lk_get, form_ids) -> set`, `lead_email(lead, qids) -> str|None`, `deal_stage_by_contact(deals, stages) -> {contactId: stage}`, `aggregate(leads, qids, contacts, deals, stages) -> list[row]`.

- [ ] **Step 1: Write `tests/test_lead_status.py`**

```python
import json, unittest

import lead_status as ls

STAGES = {"s1": "Cold", "s2": "Warm", "s3": "Hot", "s4": "Won", "s5": "Lost"}
TS = 1790000000000  # 2026-09-21T14:13:20Z


def lead(email, ts=TS, account=1, campaign=10, ad=100, test=False, qid=7, form=55):
    return {
        "owner": {"sponsoredAccount": f"urn:li:sponsoredAccount:{account}"}, "testLead": test,
        "versionedLeadGenFormUrn": f"urn:li:versionedLeadGenForm:(urn:li:leadGenForm:{form},1)", "submittedAt": ts,
        "leadMetadata": {"sponsoredLeadMetadata": {"campaign": f"urn:li:sponsoredCampaign:{campaign}"}} if campaign else {},
        "associatedEntity": {"associatedCreative": f"urn:li:sponsoredCreative:{ad}"} if ad else {},
        "formResponse": {"answers": [
            {"questionId": 1, "answerDetails": {"textQuestionAnswer": {"answer": "Jane"}}},
            *([{"questionId": qid, "answerDetails": {"textQuestionAnswer": {"answer": email}}}] if email else []),
        ]},
    }


class Parsing(unittest.TestCase):
    def test_form_id(self):
        self.assertEqual(ls.form_id(lead("a@x.com")), "55")
        self.assertIsNone(ls.form_id({}))

    def test_email_question_ids(self):
        forms = {"55": [{"questionId": 1, "predefinedField": "FIRST_NAME"}, {"questionId": 7, "predefinedField": "EMAIL"}],
                 "66": [{"questionId": 9, "predefinedField": "EMAIL"}]}
        seen = []
        def lk_get(path, query):
            seen.append(path)
            return {"content": {"questions": forms[path.rsplit("/", 1)[-1]]}}
        self.assertEqual(ls.email_question_ids(lk_get, {"55", "66"}), {7, 9})
        self.assertEqual(sorted(seen), ["/leadForms/55", "/leadForms/66"])

    def test_lead_email_normalised(self):
        self.assertEqual(ls.lead_email(lead("  Jane@X.com "), {7}), "jane@x.com")
        self.assertIsNone(ls.lead_email(lead(None), {7}))

    def test_fetch_leads_pages(self):
        calls = []
        def lk_get(path, query):
            calls.append((path, query))
            return {"elements": [{}] * (200 if len(calls) == 1 else 3)}
        enc = lambda s: s.replace(":", "%3A")
        self.assertEqual(len(ls.fetch_leads(lk_get, enc, 1)), 203)
        self.assertEqual(calls[0][0], "/leadFormResponses")
        self.assertIn("owner=(sponsoredAccount:urn%3Ali%3AsponsoredAccount%3A1)", calls[0][1])
        self.assertIn("leadType=(leadType:SPONSORED)", calls[0][1])
        self.assertIn("start=0&count=200", calls[0][1])
        self.assertIn("start=200&count=200", calls[1][1])


class Status(unittest.TestCase):
    def test_deal_stage_precedence(self):
        deals = [{"attributes": {"deal_stage": "s5"}, "linkedContactsIds": [1]},
                 {"attributes": {"deal_stage": "s2"}, "linkedContactsIds": [1, 2]},
                 {"attributes": {"deal_stage": "s4"}, "linkedContactsIds": [3]},
                 {"attributes": {"deal_stage": "s5"}, "linkedContactsIds": [5]},
                 {"attributes": {"deal_stage": "zzz"}, "linkedContactsIds": [4]}]
        self.assertEqual(ls.deal_stage_by_contact(deals, STAGES), {1: "Warm", 2: "Warm", 3: "Won", 5: "Lost"})

    def test_aggregate_statuses(self):
        contacts = [{"id": 1, "email": "a@x.com"}, {"id": 2, "email": "B@x.com", "emailBlacklisted": True},
                    {"id": 3, "email": "c@x.com"}]
        deals = [{"attributes": {"deal_stage": "s3"}, "linkedContactsIds": [1]}]
        leads = [lead("a@x.com"), lead("b@x.com"), lead("b@x.com"), lead("d@x.com"), lead(None),
                 lead("e@x.com", test=True), lead("c@x.com", campaign=None, ad=None, account=2)]
        rows = ls.aggregate(leads, {7}, contacts, deals, STAGES)
        self.assertEqual(rows, [
            {"date": "2026-09-21", "accountId": 1, "campaignId": 10, "adId": 100, "status": "Not in Brevo", "count": 2, "unsubscribed": 0},
            {"date": "2026-09-21", "accountId": 1, "campaignId": 10, "adId": 100, "status": "In Brevo, no deal", "count": 2, "unsubscribed": 2},
            {"date": "2026-09-21", "accountId": 1, "campaignId": 10, "adId": 100, "status": "Hot", "count": 1, "unsubscribed": 0},
            {"date": "2026-09-21", "accountId": 2, "campaignId": None, "adId": None, "status": "In Brevo, no deal", "count": 1, "unsubscribed": 0},
        ])

    def test_aggregate_has_no_personal_data(self):
        out = json.dumps(ls.aggregate([lead("a@x.com"), lead("zz@y.org")], {7}, [{"id": 1, "email": "a@x.com"}], [], STAGES))
        self.assertNotIn("@", out)
        self.assertNotIn("Jane", out)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run** tests — Expected: ERROR `No module named 'lead_status'`.

- [ ] **Step 3: Write `lead_status.py`**

```python
#!/usr/bin/env python3
"""LinkedIn Lead Sync leads joined with their Brevo status, aggregated for the dashboard.

Only counts leave this module: rows of {date, accountId, campaignId, adId, status, count, unsubscribed}.
Emails are used in memory for the join and never returned, logged or written.
"""
import re
from collections import Counter
from datetime import datetime, timezone

STATUSES = ["Not in Brevo", "In Brevo, no deal", "Cold", "Warm", "Hot", "Won", "Lost"]
DEAL_RANK = {"Lost": 1, "Cold": 2, "Warm": 3, "Hot": 4, "Won": 5}  # most advanced deal wins


def urn_id(urn):
    return int(urn.rsplit(":", 1)[-1]) if urn else None


def form_id(lead):
    m = re.search(r"leadGenForm:(\d+)", lead.get("versionedLeadGenFormUrn", ""))
    return m.group(1) if m else None


def fetch_leads(lk_get, enc, account_id):
    owner = f"(sponsoredAccount:{enc(f'urn:li:sponsoredAccount:{account_id}')})"
    out, start = [], 0
    while True:
        els = lk_get("/leadFormResponses", f"q=owner&owner={owner}&leadType=(leadType:SPONSORED)"
                                           f"&limitedToTestLeads=false&start={start}&count=200").get("elements", [])
        out += els
        start += len(els)
        if len(els) < 200:
            return out


def email_question_ids(lk_get, form_ids):
    ids = set()
    for fid in sorted(form_ids):
        for q in (lk_get(f"/leadForms/{fid}", "").get("content") or {}).get("questions", []):
            if q.get("predefinedField") == "EMAIL":
                ids.add(q.get("questionId"))
    return ids


def lead_email(lead, email_qids):
    for a in (lead.get("formResponse") or {}).get("answers", []):
        if a.get("questionId") in email_qids:
            value = ((a.get("answerDetails") or {}).get("textQuestionAnswer") or {}).get("answer")
            if value:
                return value.strip().lower()
    return None


def deal_stage_by_contact(deals, stages):
    best = {}
    for d in deals:
        name = stages.get((d.get("attributes") or {}).get("deal_stage"))
        if name not in DEAL_RANK:
            continue
        for cid in d.get("linkedContactsIds", []):
            if DEAL_RANK[name] > DEAL_RANK.get(best.get(cid), 0):
                best[cid] = name
    return best


def aggregate(leads, email_qids, contacts, deals, stages):
    by_email = {c["email"].strip().lower(): c for c in contacts if c.get("email")}
    stage_by_contact = deal_stage_by_contact(deals, stages)
    counts, unsubscribed = Counter(), Counter()
    for lead in leads:
        if lead.get("testLead"):
            continue
        contact = by_email.get(lead_email(lead, email_qids))
        status = "Not in Brevo" if contact is None else stage_by_contact.get(contact["id"], "In Brevo, no deal")
        key = (datetime.fromtimestamp(lead["submittedAt"] / 1000, timezone.utc).date().isoformat(),
               urn_id((lead.get("owner") or {}).get("sponsoredAccount")),
               urn_id(((lead.get("leadMetadata") or {}).get("sponsoredLeadMetadata") or {}).get("campaign")),
               urn_id((lead.get("associatedEntity") or {}).get("associatedCreative")),
               status)
        counts[key] += 1
        if contact is not None and contact.get("emailBlacklisted"):
            unsubscribed[key] += 1
    rows = [{"date": k[0], "accountId": k[1], "campaignId": k[2], "adId": k[3], "status": k[4],
             "count": n, "unsubscribed": unsubscribed[k]} for k, n in counts.items()]
    rows.sort(key=lambda r: (r["date"], r["accountId"] or 0, r["campaignId"] or 0, r["adId"] or 0,
                             STATUSES.index(r["status"])))
    return rows
```

- [ ] **Step 4: Run** tests — Expected: OK.

- [ ] **Step 5: Commit** `git add lead_status.py tests/test_lead_status.py && git commit -m "Lead status: Lead Sync fetch, Brevo join, aggregates only"`

---

### Task 3: Wire into `build_data.py` and run live

**Files:** Modify `build_data.py`, `tests/test_build_data.py`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `build_lead_status(accounts_cfg, li_api, brevo_fetch) -> list[row]`; `data.json["leadStatus"]`.

- [ ] **Step 1: Append to `tests/test_build_data.py`** (before `if __name__`):

```python
class LeadStatusWiring(unittest.TestCase):
    def test_build_lead_status_joins_both_apis(self):
        lead = {"owner": {"sponsoredAccount": "urn:li:sponsoredAccount:1"}, "testLead": False,
                "versionedLeadGenFormUrn": "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:55,1)",
                "submittedAt": 1790000000000,
                "leadMetadata": {"sponsoredLeadMetadata": {"campaign": "urn:li:sponsoredCampaign:10"}},
                "associatedEntity": {"associatedCreative": "urn:li:sponsoredCreative:100"},
                "formResponse": {"answers": [{"questionId": 7, "answerDetails": {"textQuestionAnswer": {"answer": "A@x.com"}}}]}}

        class Li:
            enc = staticmethod(lambda s: s)
            @staticmethod
            def get(path, query):
                if path == "/leadFormResponses":
                    return {"elements": [lead]}
                if path == "/leadForms/55":
                    return {"content": {"questions": [{"questionId": 7, "predefinedField": "EMAIL"}]}}
                raise AssertionError(path)

        def brevo_fetch(path):
            if path.startswith("/contacts"):
                return {"count": 1, "contacts": [{"id": 9, "email": "a@x.com"}]}
            if path.startswith("/crm/deals"):
                return {"items": [{"attributes": {"deal_stage": "w"}, "linkedContactsIds": [9]}]}
            if path == "/crm/pipeline/details/all":
                return [{"stages": [{"id": "w", "name": "Warm"}]}]
            raise AssertionError(path)

        rows = bd.build_lead_status([{"id": 1, "label": "ACME"}], Li, brevo_fetch)
        self.assertEqual(rows, [{"date": "2026-09-21", "accountId": 1, "campaignId": 10, "adId": 100,
                                 "status": "Warm", "count": 1, "unsubscribed": 0}])
```

- [ ] **Step 2: Run** tests — Expected: ERROR `module 'build_data' has no attribute 'build_lead_status'`.

- [ ] **Step 3: Edit `build_data.py`**

Change the import line `import linkedin_ads as li` to:

```python
import brevo
import lead_status as ls
import linkedin_ads as li
```

Add before `def main():`:

```python
def build_lead_status(accounts_cfg, li_api, brevo_fetch):
    leads = [lead for cfg in accounts_cfg for lead in ls.fetch_leads(li_api.get, li_api.enc, cfg["id"])]
    email_qids = ls.email_question_ids(li_api.get, {ls.form_id(lead) for lead in leads} - {None})
    return ls.aggregate(leads, email_qids, brevo.contacts(brevo_fetch), brevo.deals(brevo_fetch),
                        brevo.stages(brevo_fetch))
```

In `main()`, replace

```python
    data = build(cfg, li, date.today(), datetime.now(timezone.utc).isoformat(timespec="seconds"))
```

with

```python
    data = build(cfg, li, date.today(), datetime.now(timezone.utc).isoformat(timespec="seconds"))
    key = brevo.load_key()
    data["leadStatus"] = build_lead_status(cfg, li, lambda path: brevo.get(path, key))
```

and add after the existing `print(f"{len(data['daily'])} daily rows …")` line:

```python
    by_status = {}
    for r in data["leadStatus"]:
        by_status[r["status"]] = by_status.get(r["status"], 0) + r["count"]
    print(f"{sum(by_status.values())} leads from forms: " + ", ".join(f"{k} {v}" for k, v in by_status.items()))
```

- [ ] **Step 4: Run** tests — Expected: OK.

- [ ] **Step 5: Live run and consistency**

Run: `python3 build_data.py` then
`python3 -c "import json;d=json.load(open('site/data.json'));print(len(d['leadStatus']), 'rows');print('@' in json.dumps(d['leadStatus']))"`
Expected: lead totals ≈ exploration (3CC 345: 51 / 285 / 7 Warm / 2 Hot; C2 1,567: 157 / 1,398 / 4 Cold / 7 Warm / 1 Hot; small drift allowed for leads/deals added since); `False` for "@".

- [ ] **Step 6: Commit** `git add build_data.py tests/test_build_data.py && git commit -m "Data: leadStatus aggregates in data.json"`

---

### Task 4: `site/leads.js` — pure lead calculations

**Files:** Create `site/leads.js`, `tests/leads.test.mjs`

**Interfaces:**
- Consumes: `addDays`, `toDate` from `metrics.js`; `leadStatus` rows.
- Produces: `STATUSES`, `filterLeadRows(rows, range, accountIds:Set, campaignId|null)`, `statusTotals(rows) -> {total, byStatus, unsubscribed, inBrevo, deals, hot, won}`, `funnel(t) -> [{key, label, value, rate}]`, `dealSentence(t, f) -> string`, `weekStart(iso)`, `weeklyStatus(rows, range) -> {weeks, series: Map<status, number[]>}`, `leadTable(rows, level, nameOf, spendById:Map, totalSpend) -> {rows, total}`.

- [ ] **Step 1: Write `tests/leads.test.mjs`**

```js
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
  assert.deepEqual(steps.map((s) => s.rate), [null, 13 / 15, 5 / 13, 1 / 5, 1]);
  assert.deepEqual(L.funnel(L.statusTotals([])).map((s) => s.rate), [null, null, null, null, null]);
});

test("dealSentence variants", () => {
  assert.equal(L.dealSentence({ total: 0, deals: 0, hot: 0, won: 0 }, f), "");
  assert.equal(L.dealSentence({ total: 5, deals: 0, hot: 0, won: 0 }, f), "None of them has become a deal in your CRM yet.");
  assert.equal(L.dealSentence({ total: 30, deals: 21, hot: 3, won: 0 }, f), "So far, 21 of them became deals in your CRM, and 3 are Hot.");
  assert.equal(L.dealSentence({ total: 30, deals: 21, hot: 3, won: 1 }, f), "So far, 21 of them became deals in your CRM, 3 are Hot and 1 was won.");
  assert.equal(L.dealSentence({ total: 30, deals: 1, hot: 0, won: 1 }, f), "So far, 1 of them became a deal in your CRM, and 1 was won.");
  assert.equal(L.dealSentence({ total: 30, deals: 2, hot: 1, won: 0 }, f), "So far, 2 of them became deals in your CRM, and 1 is Hot.");
  assert.equal(L.dealSentence({ total: 30, deals: 4, hot: 0, won: 2 }, f), "So far, 4 of them became deals in your CRM, and 2 were won.");
  assert.equal(L.dealSentence({ total: 30, deals: 4, hot: 0, won: 0 }, f), "So far, 4 of them became deals in your CRM.");
});

test("weekStart is the Monday", () => {
  assert.equal(L.weekStart("2026-10-01"), "2026-09-28");
  assert.equal(L.weekStart("2026-09-28"), "2026-09-28");
  assert.equal(L.weekStart("2026-10-04"), "2026-09-28");
});

test("weeklyStatus stacks counts per Monday week, every status present", () => {
  const { weeks, series } = L.weeklyStatus(rows, { start: "2026-09-29", end: "2026-10-06" });
  assert.deepEqual(weeks, ["2026-09-28", "2026-10-05"]);
  assert.deepEqual(series.get("Not in Brevo"), [2, 0]);
  assert.deepEqual(series.get("In Brevo, no deal"), [8, 0]);
  assert.deepEqual(series.get("Won"), [1, 0]);
  assert.deepEqual(series.get("Lost"), [0, 1]);
  assert.deepEqual([...series.keys()], L.STATUSES);
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
```

- [ ] **Step 2: Run** `node --test tests/*.test.mjs` — Expected: FAIL `Cannot find module '.../site/leads.js'`.

- [ ] **Step 3: Write `site/leads.js`**

```js
// Lead status (LinkedIn forms joined with Brevo): filters, totals, funnel, sentence, weekly series, table. Pure.
import { addDays, toDate } from "./metrics.js";

export const STATUSES = ["Not in Brevo", "In Brevo, no deal", "Cold", "Warm", "Hot", "Won", "Lost"];
const DEAL_STATUSES = ["Cold", "Warm", "Hot", "Won", "Lost"];

export function filterLeadRows(rows, { start, end }, accountIds, campaignId) {
  return rows.filter((r) => r.date >= start && r.date <= end && accountIds.has(r.accountId)
    && (!campaignId || r.campaignId === campaignId));
}

export function statusTotals(rows) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let total = 0, unsubscribed = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + r.count;
    total += r.count;
    unsubscribed += r.unsubscribed || 0;
  }
  const deals = DEAL_STATUSES.reduce((s, k) => s + byStatus[k], 0);
  return { total, byStatus, unsubscribed, inBrevo: total - byStatus["Not in Brevo"], deals, hot: byStatus.Hot, won: byStatus.Won };
}

export function funnel(t) {
  const steps = [["leads", "Leads (forms)", t.total], ["inBrevo", "In Brevo", t.inBrevo], ["deals", "Deals", t.deals],
    ["hot", "Hot", t.hot], ["won", "Won", t.won]];
  return steps.map(([key, label, value], i) => ({
    key, label, value, rate: i === 0 || !steps[i - 1][2] ? null : value / steps[i - 1][2],
  }));
}

export function dealSentence(t, f) {
  if (!t.total) return "";
  if (!t.deals) return "None of them has become a deal in your CRM yet.";
  const head = `So far, ${f.num(t.deals)} of them ${t.deals === 1 ? "became a deal" : "became deals"} in your CRM`;
  const parts = [];
  if (t.hot) parts.push(`${f.num(t.hot)} ${t.hot === 1 ? "is" : "are"} Hot`);
  if (t.won) parts.push(`${f.num(t.won)} ${t.won === 1 ? "was" : "were"} won`);
  if (!parts.length) return `${head}.`;
  return parts.length === 1 ? `${head}, and ${parts[0]}.` : `${head}, ${parts.join(" and ")}.`;
}

export const weekStart = (iso) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));

export function weeklyStatus(rows, { start, end }) {
  const weeks = [];
  for (let w = weekStart(start); w <= end; w = addDays(w, 7)) weeks.push(w);
  const index = new Map(weeks.map((w, i) => [w, i]));
  const series = new Map(STATUSES.map((s) => [s, weeks.map(() => 0)]));
  for (const r of rows) {
    const i = index.get(weekStart(r.date));
    if (i != null && series.has(r.status)) series.get(r.status)[i] += r.count;
  }
  return { weeks, series };
}

export function leadTable(rows, level, nameOf, spendById, totalSpend) {
  const key = level === "ad" ? "adId" : "campaignId";
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r[key])) groups.set(r[key], []);
    groups.get(r[key]).push(r);
  }
  const entry = (id, rs, spend) => {
    const t = statusTotals(rs);
    return { id, name: nameOf(id), ...t, spend, costPerDeal: t.deals && spend != null ? spend / t.deals : null };
  };
  const list = [...groups]
    .map(([id, rs]) => entry(id, rs, id == null ? null : spendById.get(id) ?? null))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.deals - a.deals || b.total - a.total);
  return { rows: list, total: { ...entry(null, rows, totalSpend), name: "Total" } };
}
```

- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — Expected: all pass.

- [ ] **Step 5: Commit** `git add site/leads.js tests/leads.test.mjs && git commit -m "Leads: pure status totals, funnel, sentence, weekly series, table"`

---

### Task 5: UI — Overview block and Leads tab

**Files:** Modify `site/index.html`, `site/style.css`, `site/ui.js`, `site/overview.js`, `site/app.js`; create `site/leads-view.js`

**Interfaces:**
- Consumes: Task 4; `data.leadStatus` (absent in old data → treated as `[]`).
- Produces: `leads-view.js` exports `STATUS_COLORS`, `renderLeadFunnel(container, totals, f, withRates)`, `renderLeads(ctx, {onLevel})`; `renderOverview(ctx, {onShowLeads})`; `ctx.leadRows`.

- [ ] **Step 1: `site/index.html`**
  - In `<nav class="tabs">`, after the Ads button, add:
    `<button type="button" role="tab" id="tab-leads" data-tab="leads" aria-controls="panel-leads">Leads</button>`
  - After `<p id="story" …></p>` add:

```html
      <p id="deal-story" class="story-sub" hidden></p>
      <div id="lead-block" class="lead-block" hidden>
        <ol id="lead-funnel" class="lead-funnel"></ol>
        <div id="lead-warning" class="warning" hidden></div>
      </div>
```

  - Change `<table id="sheet">` to `<table id="sheet" class="datatable">`.
  - Before `<section id="panel-sheet" …>` add:

```html
    <section id="panel-leads" role="tabpanel" aria-labelledby="tab-leads" hidden>
      <div class="panel-head"><h2>What happened to your leads</h2></div>
      <ol id="leads-funnel" class="lead-funnel"></ol>
      <p id="leads-empty" class="empty" hidden>No leads in this period.</p>
      <div class="charts">
        <figure class="card wide"><figcaption>Leads per week, by status today</figcaption><div class="plot"><canvas id="chart-leadstatus" role="img" aria-label="Leads per week, stacked by status"></canvas></div></figure>
      </div>
      <div class="panel-head table-head">
        <h2>By campaign or ad</h2>
        <label class="field">Show
          <select id="lead-level">
            <option value="campaign">By campaign</option>
            <option value="ad">By ad</option>
          </select>
        </label>
      </div>
      <div class="sheet-wrap"><table id="lead-table" class="datatable"><thead></thead><tbody></tbody></table></div>
    </section>
```

- [ ] **Step 2: `site/style.css`**
  - Replace every selector `#sheet` that is not followed by `-` or a word character with `.datatable` (Python: `re.sub(r"#sheet(?![-\w])", ".datatable", css)`), keeping `#sheet-empty`.
  - After each of the three `--series-2` declarations add the status tokens — light (in `:root`):
    `--st-0: #86b6ef; --st-1: #5598e7; --st-2: #2a78d6; --st-3: #1c5cab; --st-4: #104281; --st-5: #0d366b; --st-lost: #a8a7a1;`
    dark (both dark blocks):
    `--st-0: #184f95; --st-1: #256abf; --st-2: #3987e5; --st-3: #6da7ec; --st-4: #9ec5f4; --st-5: #cde2fb; --st-lost: #6f6e69;`
  - Append:

```css
.story-sub { font-size: 17px; margin: -8px 0 16px; color: var(--text-secondary); max-width: 62ch; }
.lead-block { margin-bottom: 20px; }
.lead-funnel { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.lead-funnel li { position: relative; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
.lead-funnel li + li::before { content: "→"; position: absolute; left: -11px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 14px; }
.lf-value { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
.lf-label { font-size: 13px; color: var(--text-secondary); }
.lf-rate { font-size: 12px; color: var(--text-muted); }
.warning { margin-top: 12px; padding: 12px 14px; border-radius: 12px; background: var(--warn-bg); color: var(--text-primary); display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.table-head { margin-top: 28px; }
@media (max-width: 640px) {
  .lead-funnel { grid-template-columns: 1fr 1fr; }
  .lead-funnel li:nth-child(odd)::before { display: none; }
}
```

- [ ] **Step 3: Validate status colours**

Run (from the dataviz skill directory):
`node scripts/validate_palette.js "#86b6ef,#5598e7,#2a78d6,#1c5cab,#104281,#0d366b" --mode light --ordinal` and
`node scripts/validate_palette.js "#184f95,#256abf,#3987e5,#6da7ec,#9ec5f4,#cde2fb" --mode dark --ordinal`
Expected: no FAIL (WARN on adjacent separation is acceptable for an ordinal ramp with legend + tooltip; record it).

- [ ] **Step 4: `site/ui.js`** — add to `GLOSSARY` after the `formRate` entry:

```js
  formLeads: "Leads (forms): people who sent your LinkedIn form. Can differ slightly from the ad-reported leads, which LinkedIn counts separately.",
  inBrevo: "In Brevo: leads found in your Brevo contacts (matched by email).",
  notInBrevo: "Not in Brevo: leads that were never added to Brevo, so nobody can follow them up.",
  deals: "Deals: leads with an opportunity in your Brevo sales pipeline (Cold, Warm, Hot, Won or Lost).",
  hot: "Hot: deals marked Hot in your pipeline.",
  won: "Won: deals marked Won in your pipeline.",
  costPerDeal: "Cost per deal: ad spend ÷ number of deals.",
  unsubscribed: "Unsubscribed: leads who unsubscribed from your emails.",
```

- [ ] **Step 5: Create `site/leads-view.js`**

```js
// Leads tab: where the ads' leads stand today in Brevo (funnel, weekly status chart, table).
import * as L from "./leads.js";
import * as M from "./metrics.js";
import { el, info, drawStacked, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);
const STEP_HELP = { leads: "formLeads", inBrevo: "inBrevo", deals: "deals", hot: "hot", won: "won" };
export const STATUS_COLORS = { "Not in Brevo": "--st-0", "In Brevo, no deal": "--st-1", Cold: "--st-2", Warm: "--st-3",
  Hot: "--st-4", Won: "--st-5", Lost: "--st-lost" };

export function renderLeadFunnel(container, totals, f, withRates) {
  container.replaceChildren(...L.funnel(totals).map((s) => {
    const li = el("li");
    const label = el("div", "lf-label", s.label);
    label.append(info(GLOSSARY[STEP_HELP[s.key]]));
    li.append(el("div", "lf-value", f.num(s.value)), label);
    if (withRates && s.rate != null) li.append(el("div", "lf-rate", `${f.pct(s.rate)} of previous step`));
    return li;
  }));
}

const COLS = [
  { key: "total", label: "Leads", help: "formLeads" },
  { status: "Not in Brevo", label: "Not in Brevo", help: "notInBrevo" },
  { status: "In Brevo, no deal", label: "No deal" },
  { status: "Cold", label: "Cold" },
  { status: "Warm", label: "Warm" },
  { status: "Hot", label: "Hot", help: "hot" },
  { status: "Won", label: "Won", help: "won" },
  { status: "Lost", label: "Lost" },
  { key: "unsubscribed", label: "Unsubscribed", help: "unsubscribed" },
  { key: "deals", label: "Deals", help: "deals" },
  { key: "costPerDeal", label: "Cost per deal", help: "costPerDeal", money: true },
];

function rowEl(e, f, cls) {
  const tr = el("tr", cls);
  tr.append(el("td", "col-label", e.name));
  for (const c of COLS) {
    const v = c.status ? e.byStatus[c.status] : e[c.key];
    tr.append(el("td", null, c.money ? f.money(v) : f.num(v)));
  }
  return tr;
}

export function renderLeads({ leadRows, rows, range, state, f, adsById, campaignsById }, { onLevel }) {
  const totals = L.statusTotals(leadRows);
  renderLeadFunnel($("leads-funnel"), totals, f, true);
  $("leads-empty").hidden = totals.total > 0;

  const { weeks, series } = L.weeklyStatus(leadRows, range);
  drawStacked("chart-leadstatus", weeks.map((w) => `Week of ${f.day(w)}`),
    L.STATUSES.map((s) => ({ label: s, values: series.get(s), colorVar: STATUS_COLORS[s] })), f.num, f.compact);

  const level = state.leadLevel;
  $("lead-level").value = level;
  $("lead-level").onchange = (e) => onLevel(e.target.value);
  const key = level === "ad" ? "adId" : "campaignId";
  const nameOf = level === "ad"
    ? (id) => (id == null ? "Unknown ad" : adsById.get(id)?.name || `Ad ${id}`)
    : (id) => (id == null ? "Unknown campaign" : campaignsById.get(id)?.name || `Campaign ${id}`);
  const spend = new Map([...M.groupTotals(rows, key)].map(([id, t]) => [id, t.spend]));
  const table = L.leadTable(leadRows, level, nameOf, spend, M.totals(rows).spend);

  const head = el("tr");
  head.append(el("th", "col-label", level === "ad" ? "Ad" : "Campaign"));
  for (const c of COLS) {
    const th = el("th", null, c.label);
    if (c.help) th.append(info(GLOSSARY[c.help]));
    head.append(th);
  }
  $("lead-table").tHead.replaceChildren(head, rowEl(table.total, f, "totals"));
  $("lead-table").tBodies[0].replaceChildren(...table.rows.map((e) => rowEl(e, f)));
}
```

- [ ] **Step 6: `site/overview.js`**
  - Add imports: `import * as L from "./leads.js";` and `import { renderLeadFunnel } from "./leads-view.js";`
  - Add before `export function renderOverview`:

```js
function renderLeadBlock(leadRows, f, onShowLeads) {
  const t = L.statusTotals(leadRows);
  const sentence = L.dealSentence(t, f);
  $("deal-story").hidden = !sentence;
  $("deal-story").textContent = sentence;
  $("lead-block").hidden = !t.total;
  if (!t.total) return;
  renderLeadFunnel($("lead-funnel"), t, f, false);
  const missing = t.byStatus["Not in Brevo"];
  const warn = $("lead-warning");
  warn.hidden = !missing;
  if (missing) {
    const link = el("button", "link", "See which campaigns →");
    link.type = "button";
    link.onclick = onShowLeads;
    warn.replaceChildren(el("span", null, `⚠️ ${I.count(missing, "lead", f.num)} from this period ${missing === 1 ? "is" : "are"} `
      + `not in Brevo yet, so nobody can follow ${missing === 1 ? "it" : "them"} up.`), link);
  }
}
```

  - Change the signature `export function renderOverview({ rows, cmp, range, state, f, adsById, data, accounts }) {` to
    `export function renderOverview({ rows, cmp, range, state, f, adsById, data, accounts, leadRows }, { onShowLeads }) {`
    and add `renderLeadBlock(leadRows, f, onShowLeads);` right after the `$("story").textContent = …` line.

- [ ] **Step 7: `site/app.js`**
  - `const TABS = ["overview", "ads", "sheet"];` → `const TABS = ["overview", "ads", "leads", "sheet"];`
  - Add `leadLevel: "campaign"` to `state`.
  - Add imports `import * as L from "./leads.js";` and `import { renderLeads } from "./leads-view.js";`
  - In `render()` ctx, after `accounts: selectedAccounts(),` add:
    `leadRows: L.filterLeadRows(data.leadStatus || [], range, new Set(selectedAccounts().map((a) => a.id)), state.campaign),`
  - Replace `if (state.tab === "overview") renderOverview(ctx);` with:

```js
  if (state.tab === "overview") {
    renderOverview(ctx, { onShowLeads: () => { state.tab = "leads"; render(); window.scrollTo(0, 0); } });
  }
  if (state.tab === "leads") renderLeads(ctx, { onLevel: (level) => { state.leadLevel = level; render(); } });
```

- [ ] **Step 8: Checks** — `for f in site/*.js; do node --check "$f" || exit 1; done && node --test tests/*.test.mjs && python3 -m unittest discover -s tests -t .` — Expected: all pass.

- [ ] **Step 9: Browser check** (`python3 -m http.server 8123 -d site`, Chrome):
  - Overview for Both / 3CC / C2 × last 30 days, year to date, all time: deal sentence reads correctly; funnel strip counts; warning card shows the Not-in-Brevo count and its link opens the Leads tab; no NaN/undefined.
  - All time totals match Task 3 numbers per account (Both = 3CC + C2).
  - Leads tab: funnel with rates, weekly stacked chart with 7-status legend and tooltip total, table by campaign and by ad with totals row and cost per deal; campaign filter limits rows; "Unknown campaign" row visible only without campaign filter.
  - Sheet tab still styled (datatable class refactor) — totals row, shading, sticky date column.
  - Dark mode, 390 px (iframe), no console errors.

- [ ] **Step 10: Commit** `git add site && git commit -m "Lead status on Overview + Leads tab"`

---

### Task 6: CI, README, release (user confirmation required)

**Files:** Modify `.github/workflows/refresh.yml`, `README.md`

- [ ] **Step 1: Workflow** — in the "Pull LinkedIn data" step `env:` add `BREVO_API_KEY: ${{ secrets.BREVO_API_KEY }}`.
- [ ] **Step 2: README** — in "How it works" add bullets `brevo.py — Brevo CRM client (contacts, deals, stages).` and `lead_status.py — LinkedIn Lead Sync leads joined with Brevo status; only counts are published.`; in the secrets table add `| BREVO_API_KEY | Brevo API key (IP blocking must stay disabled for GitHub runners) |`; in the yearly re-login section note the login now includes `r_marketing_leadgen_automation`.
- [ ] **Step 3: Commit** `git add .github/workflows/refresh.yml README.md && git commit -m "CI: Brevo key; README: lead status"`
- [ ] **Step 4: Ask the user**, then set secrets without printing values:

```bash
grep '^BREVO_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | gh secret set BREVO_API_KEY -R beafb/linkedin-ads-dashboard
python3 -c "import json;print(json.load(open('.linkedin_tokens.json'))['refresh_token'],end='')" | gh secret set LKDN_REFRESH_TOKEN -R beafb/linkedin-ads-dashboard
python3 -c "import json;print(json.load(open('.linkedin_tokens.json'))['refresh_expires_at'],end='')" | gh secret set LKDN_REFRESH_EXPIRES_AT -R beafb/linkedin-ads-dashboard
```

- [ ] **Step 5: Release** — `git checkout main && git merge --ff-only feat/leads && git push origin main`; watch the run; verify live `data.json` has `leadStatus` with no "@" and the Leads tab renders (hard reload).
