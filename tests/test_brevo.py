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
