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
