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
