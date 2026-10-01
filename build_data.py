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
