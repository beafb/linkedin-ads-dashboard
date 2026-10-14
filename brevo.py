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


MAX_PAGES = 1000  # safety stop: a server that never returns an empty page must not loop forever


# Paging advances by what the server actually returned (it may cap page size) and stops on an empty page.
def contacts(fetch):
    out = []
    for _ in range(MAX_PAGES):
        r = fetch(f"/contacts?limit=1000&offset={len(out)}")
        page = r.get("contacts", [])
        out += page
        if not page or len(out) >= r.get("count", float("inf")):
            return out
    sys.exit(f"Brevo contacts: still not finished after {MAX_PAGES} pages")


def deals(fetch):
    out = []
    for _ in range(MAX_PAGES):
        items = fetch(f"/crm/deals?limit=500&offset={len(out)}").get("items", [])
        if not items:
            return out
        out += items
    sys.exit(f"Brevo deals: still not finished after {MAX_PAGES} pages")


def stages(fetch):
    return {s["id"]: s["name"] for p in fetch("/crm/pipeline/details/all") for s in p.get("stages", [])}
