#!/usr/bin/env python3
"""LinkedIn Lead Sync leads joined with their Brevo status, aggregated for the dashboard.

Only counts leave this module: rows of {date, accountId, campaignId, adId, status, count, unsubscribed}.
Emails are used in memory for the join and never returned, logged or written.
"""
import re
from collections import Counter
from datetime import datetime, timezone

STATUSES = ["Not in Brevo", "In Brevo, no deal", "Cold", "Warm", "Hot", "Won", "Lost"]
DEAL_RANK = {"Lost": 1, "Cold": 2, "Warm": 3, "Hot": 4, "Won": 5}  # most advanced deal wins


def urn_id(urn):
    return int(urn.rsplit(":", 1)[-1]) if urn else None


def form_id(lead):
    m = re.search(r"leadGenForm:(\d+)", lead.get("versionedLeadGenFormUrn", ""))
    return m.group(1) if m else None


def fetch_leads(lk_get, enc, account_id):
    owner = f"(sponsoredAccount:{enc(f'urn:li:sponsoredAccount:{account_id}')})"
    out, start = [], 0
    while True:
        els = lk_get("/leadFormResponses", f"q=owner&owner={owner}&leadType=(leadType:SPONSORED)"
                                           f"&limitedToTestLeads=false&start={start}&count=200").get("elements", [])
        out += els
        start += len(els)
        if len(els) < 200:
            return out


def email_question_ids(lk_get, form_ids):
    ids = set()
    for fid in sorted(form_ids):
        for q in (lk_get(f"/leadForms/{fid}", "").get("content") or {}).get("questions", []):
            if q.get("predefinedField") == "EMAIL":
                ids.add(q.get("questionId"))
    return ids


def lead_email(lead, email_qids):
    for a in (lead.get("formResponse") or {}).get("answers", []):
        if a.get("questionId") in email_qids:
            value = ((a.get("answerDetails") or {}).get("textQuestionAnswer") or {}).get("answer")
            if value:
                return value.strip().lower()
    return None


def deal_stage_by_contact(deals, stages):
    best = {}
    for d in deals:
        name = stages.get((d.get("attributes") or {}).get("deal_stage"))
        if name not in DEAL_RANK:
            continue
        for cid in d.get("linkedContactsIds", []):
            if DEAL_RANK[name] > DEAL_RANK.get(best.get(cid), 0):
                best[cid] = name
    return best


def aggregate(leads, email_qids, contacts, deals, stages):
    by_email = {c["email"].strip().lower(): c for c in contacts if c.get("email")}
    stage_by_contact = deal_stage_by_contact(deals, stages)
    counts, unsubscribed = Counter(), Counter()
    for lead in leads:
        if lead.get("testLead"):
            continue
        contact = by_email.get(lead_email(lead, email_qids))
        status = "Not in Brevo" if contact is None else stage_by_contact.get(contact["id"], "In Brevo, no deal")
        key = (datetime.fromtimestamp(lead["submittedAt"] / 1000, timezone.utc).date().isoformat(),
               urn_id((lead.get("owner") or {}).get("sponsoredAccount")),
               urn_id(((lead.get("leadMetadata") or {}).get("sponsoredLeadMetadata") or {}).get("campaign")),
               urn_id((lead.get("associatedEntity") or {}).get("associatedCreative")),
               status)
        counts[key] += 1
        if contact is not None and contact.get("emailBlacklisted"):
            unsubscribed[key] += 1
    rows = [{"date": k[0], "accountId": k[1], "campaignId": k[2], "adId": k[3], "status": k[4],
             "count": n, "unsubscribed": unsubscribed[k]} for k, n in counts.items()]
    rows.sort(key=lambda r: (r["date"], r["accountId"] or 0, r["campaignId"] or 0, r["adId"] or 0,
                             STATUSES.index(r["status"])))
    return rows
