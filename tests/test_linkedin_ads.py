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


class LoadEnv(unittest.TestCase):
    def test_missing_credentials_mention_ci_secrets(self):
        with TemporaryDirectory() as tmp, mock.patch.object(li, "ROOT", Path(tmp)), \
             mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SystemExit) as cm:
                li.load_env()
        self.assertIn("LKDN_CLIENT_ID", str(cm.exception))
        self.assertIn("repository secret", str(cm.exception))


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
