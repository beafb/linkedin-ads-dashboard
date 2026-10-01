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
