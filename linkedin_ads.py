#!/usr/bin/env python3
"""Pull LinkedIn Ads data (accounts, campaign groups, campaigns, daily analytics).

Usage:
  python3 linkedin_ads.py auth                      # one-time browser login, stores tokens
  python3 linkedin_ads.py accounts                  # list ad accounts the token can see
  python3 linkedin_ads.py pull [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--account ID|NAME ...]

Env (.env): LKDN_CLIENT_ID, LKDN_PRIMARY_CLIENT_SECRET,
            LKDN_ACCESS_TOKEN (optional, overrides everything),
            LKDN_REFRESH_TOKEN (optional, CI: exchanged in memory, nothing written to disk),
            LKDN_REDIRECT_URI (optional, default http://localhost:8765/callback)
Docs: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/ads-overview?view=li-lms-2026-09
"""
import argparse, csv, json, os, secrets, sys, time, webbrowser
import urllib.error, urllib.parse, urllib.request
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOKEN_FILE = ROOT / ".linkedin_tokens.json"
OUT_DIR = ROOT / "data" / "linkedin"
API = "https://api.linkedin.com/rest"
LI_VERSION = "202609"
SCOPES = "r_ads r_ads_reporting"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
_session_token = None  # access token obtained from LKDN_REFRESH_TOKEN for this process

# Max 20 fields per adAnalytics request (dateRange + pivotValues included to be safe)
METRICS = [
    "impressions", "clicks", "landingPageClicks", "costInLocalCurrency", "costInUsd",
    "totalEngagements", "reactions", "comments", "shares", "follows",
    "videoViews", "videoCompletions", "oneClickLeadFormOpens", "oneClickLeads",
    "externalWebsiteConversions", "conversionValueInLocalCurrency", "approximateMemberReach",
]
FIELDS = ["dateRange", "pivotValues"] + METRICS


# ---------- config / tokens ----------
def load_env():
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    for k in ("LKDN_CLIENT_ID", "LKDN_PRIMARY_CLIENT_SECRET"):
        if not os.environ.get(k):
            sys.exit(f"Missing {k} (.env locally, repository secret in CI)")
    os.environ.setdefault("LKDN_REDIRECT_URI", "http://localhost:8765/callback")


def post_form(url, data, hint=""):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Token request failed ({e.code}): {e.read().decode()} {hint}".rstrip())


def save_tokens(tok):
    now = int(time.time())
    tok["access_expires_at"] = now + int(tok.get("expires_in", 0))
    if "refresh_token_expires_in" in tok:
        tok["refresh_expires_at"] = now + int(tok["refresh_token_expires_in"])
    TOKEN_FILE.write_text(json.dumps(tok, indent=2))
    TOKEN_FILE.chmod(0o600)


def cmd_auth(_args):
    redirect = os.environ["LKDN_REDIRECT_URI"]
    parsed = urllib.parse.urlparse(redirect)
    state = secrets.token_urlsafe(16)
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if urllib.parse.urlparse(self.path).path != parsed.path:
                self.send_response(404); self.end_headers(); return
            result.update({k: v[0] for k, v in q.items()})
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
            msg = "LinkedIn auth OK - you can close this tab." if "code" in q else f"Error: {result}"
            self.wfile.write(msg.encode())

        def log_message(self, *a):
            pass

    auth_url = "https://www.linkedin.com/oauth/v2/authorization?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": os.environ["LKDN_CLIENT_ID"],
        "redirect_uri": redirect, "state": state, "scope": SCOPES})
    print(f"Opening browser for LinkedIn login...\nIf it doesn't open, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)
    server = HTTPServer((parsed.hostname, parsed.port or 80), Handler)
    while not result:
        server.handle_request()
    if result.get("state") != state:
        sys.exit("State mismatch - aborting.")
    if "code" not in result:
        sys.exit(f"Auth failed: {result}")
    tok = post_form(TOKEN_URL, {
        "grant_type": "authorization_code", "code": result["code"], "redirect_uri": redirect,
        "client_id": os.environ["LKDN_CLIENT_ID"],
        "client_secret": os.environ["LKDN_PRIMARY_CLIENT_SECRET"]})
    save_tokens(tok)
    days = int(tok.get("expires_in", 0)) // 86400
    print(f"Saved tokens to {TOKEN_FILE.name} (access valid {days} days, "
          f"refresh token: {'yes' if 'refresh_token' in tok else 'no'}).")


def refresh_access_token(refresh_token):
    tok = post_form(TOKEN_URL, {
        "grant_type": "refresh_token", "refresh_token": refresh_token,
        "client_id": os.environ["LKDN_CLIENT_ID"],
        "client_secret": os.environ["LKDN_PRIMARY_CLIENT_SECRET"]},
        hint="- refresh token rejected or expired: see README 'Yearly re-login'.")
    return tok["access_token"]


def access_token():
    global _session_token
    if os.environ.get("LKDN_ACCESS_TOKEN"):  # manual token, e.g. from the portal's Token Generator
        return os.environ["LKDN_ACCESS_TOKEN"]
    if os.environ.get("LKDN_REFRESH_TOKEN"):  # CI: no token file, keep it in memory
        if not _session_token:
            _session_token = refresh_access_token(os.environ["LKDN_REFRESH_TOKEN"])
        return _session_token
    if not TOKEN_FILE.exists():
        sys.exit("No tokens yet - run: python3 linkedin_ads.py auth")
    tok = json.loads(TOKEN_FILE.read_text())
    if time.time() < tok.get("access_expires_at", 0) - 3600:
        return tok["access_token"]
    if tok.get("refresh_token") and time.time() < tok.get("refresh_expires_at", float("inf")):
        new = post_form(TOKEN_URL, {
            "grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
            "client_id": os.environ["LKDN_CLIENT_ID"],
            "client_secret": os.environ["LKDN_PRIMARY_CLIENT_SECRET"]})
        save_tokens(new)
        return new["access_token"]
    sys.exit("Access token expired and cannot be refreshed - run: python3 linkedin_ads.py auth")


# ---------- API ----------
def enc(urn):
    return urllib.parse.quote(urn, safe="")


def get(path, query):
    """GET with a pre-encoded Rest.li query string (parens/commas must stay literal)."""
    url = f"{API}{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {access_token()}",
        "LinkedIn-Version": LI_VERSION,
        "X-Restli-Protocol-Version": "2.0.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 3:
                time.sleep(2 ** attempt * 5); continue
            sys.exit(f"GET {path} failed ({e.code}): {e.read().decode()}")


def get_all(path, query):
    """Cursor pagination (pageSize/pageToken) used by adAccounts / adCampaigns search."""
    items, token = [], None
    while True:
        q = query + "&pageSize=100" + (f"&pageToken={urllib.parse.quote(token)}" if token else "")
        res = get(path, q)
        items += res.get("elements", [])
        token = res.get("metadata", {}).get("nextPageToken")
        if not token:
            return items


def list_accounts():
    return get_all("/adAccounts", "q=search")


def cmd_accounts(_args):
    for a in list_accounts():
        print(f"{a['id']:>12}  {a.get('status',''):<10} {a.get('currency',''):<4} {a.get('name','')}")


def date_obj(d):
    return f"(year:{d.year},month:{d.month},day:{d.day})"


def pick_accounts(all_accounts, wanted):
    if not wanted:
        return all_accounts
    w = [x.lower() for x in wanted]
    return [a for a in all_accounts
            if str(a["id"]) in w or any(x in a.get("name", "").lower() for x in w)]


def cmd_pull(args):
    until = date.fromisoformat(args.until) if args.until else date.today()
    since = date.fromisoformat(args.since) if args.since else until - timedelta(days=30)
    accounts = pick_accounts(list_accounts(), args.account)
    if not accounts:
        sys.exit("No matching ad accounts. Run `accounts` to see what the token can access.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows, raw = [], {"since": since.isoformat(), "until": until.isoformat(), "accounts": []}
    for acc in accounts:
        aid, urn = acc["id"], f"urn:li:sponsoredAccount:{acc['id']}"
        print(f"→ {acc.get('name')} ({aid})")
        groups = get_all(f"/adAccounts/{aid}/adCampaignGroups", "q=search")
        campaigns = get_all(f"/adAccounts/{aid}/adCampaigns", "q=search")
        analytics = get("/adAnalytics", "&".join([
            "q=analytics", "pivot=CAMPAIGN", "timeGranularity=DAILY",
            f"dateRange=(start:{date_obj(since)},end:{date_obj(until)})",
            f"accounts=List({enc(urn)})", "fields=" + ",".join(FIELDS)])).get("elements", [])
        print(f"  {len(groups)} groups, {len(campaigns)} campaigns, {len(analytics)} daily rows")
        raw["accounts"].append({"account": acc, "campaignGroups": groups,
                                "campaigns": campaigns, "analytics": analytics})

        group_name = {f"urn:li:sponsoredCampaignGroup:{g['id']}": g.get("name") for g in groups}
        camp = {f"urn:li:sponsoredCampaign:{c['id']}": c for c in campaigns}
        for el in analytics:
            c = camp.get(el["pivotValues"][0], {})
            d = el["dateRange"]["start"]
            rows.append({
                "date": f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}",
                "account_id": aid, "account_name": acc.get("name"),
                "currency": acc.get("currency"),
                "campaign_group": group_name.get(c.get("campaignGroup"), c.get("campaignGroup")),
                "campaign_id": el["pivotValues"][0].rsplit(":", 1)[-1],
                "campaign_name": c.get("name"), "campaign_status": c.get("status"),
                "objective": c.get("objectiveType"),
                **{m: el.get(m, 0) for m in METRICS}})

    rows.sort(key=lambda r: (r["date"], r["account_name"] or "", r["campaign_name"] or ""))
    (OUT_DIR / "raw.json").write_text(json.dumps(raw, indent=2))
    csv_path = OUT_DIR / "campaign_daily.csv"
    with csv_path.open("w", newline="") as f:
        cols = ["date", "account_id", "account_name", "currency", "campaign_group", "campaign_id",
                "campaign_name", "campaign_status", "objective"] + METRICS
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
    print(f"\n{len(rows)} rows → {csv_path.relative_to(ROOT)}  (raw: data/linkedin/raw.json)")


def main():
    load_env()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("auth").set_defaults(fn=cmd_auth)
    sub.add_parser("accounts").set_defaults(fn=cmd_accounts)
    pp = sub.add_parser("pull"); pp.set_defaults(fn=cmd_pull)
    pp.add_argument("--since"); pp.add_argument("--until")
    pp.add_argument("--account", nargs="*", help="account id(s) or name substring(s), e.g. 3CC")
    args = p.parse_args(); args.fn(args)


if __name__ == "__main__":
    main()
