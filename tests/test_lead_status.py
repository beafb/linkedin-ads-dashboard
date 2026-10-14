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
        self.assertEqual(ls.email_question_ids(lk_get, {"55", "66"}), {"55": {7}, "66": {9}})
        self.assertEqual(sorted(seen), ["/leadForms/55", "/leadForms/66"])

    def test_lead_email_normalised(self):
        self.assertEqual(ls.lead_email(lead("  Jane@X.com "), {"55": {7}}), "jane@x.com")
        self.assertIsNone(ls.lead_email(lead(None), {"55": {7}}))

    def test_lead_email_uses_its_own_form(self):
        # form 66 reuses question id 1 (first name in form 55) for its email: never mix them up
        qids = {"55": {7}, "66": {1}}
        self.assertEqual(ls.lead_email(lead("a@x.com", form=55), qids), "a@x.com")
        self.assertIsNone(ls.lead_email(lead("a@x.com", form=77), qids))

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
        report = {}
        rows = ls.aggregate(leads, {"55": {7}}, contacts, deals + [{"attributes": {"deal_stage": "s9"}, "linkedContactsIds": [3]}],
                            {**STAGES, "s9": "New"}, report)
        self.assertEqual(rows, [
            {"date": "2026-09-21", "accountId": 1, "campaignId": 10, "adId": 100, "status": "Not in Brevo", "count": 2, "unsubscribed": 0},
            {"date": "2026-09-21", "accountId": 1, "campaignId": 10, "adId": 100, "status": "In Brevo, no deal", "count": 2, "unsubscribed": 2},
            {"date": "2026-09-21", "accountId": 1, "campaignId": 10, "adId": 100, "status": "Hot", "count": 1, "unsubscribed": 0},
            {"date": "2026-09-21", "accountId": 2, "campaignId": None, "adId": None, "status": "In Brevo, no deal", "count": 1, "unsubscribed": 0},
        ])
        self.assertEqual(report, {"noEmail": 1, "unknownStages": {"New": 1}})

    def test_aggregate_has_no_personal_data(self):
        out = json.dumps(ls.aggregate([lead("a@x.com"), lead("zz@y.org")], {"55": {7}}, [{"id": 1, "email": "a@x.com"}], [], STAGES))
        self.assertNotIn("@", out)
        self.assertNotIn("Jane", out)


if __name__ == "__main__":
    unittest.main()
