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
