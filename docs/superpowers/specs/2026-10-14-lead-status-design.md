# Lead Status (LinkedIn → Brevo) — Design

Date: 2026-10-14
Status: approved in conversation, pending written-spec review
Builds on: `2026-10-01-dashboard-v2-design.md` (live). Unchanged: hosting, 3-hour refresh, public site, filters, plain English.

## Goal

Show how many leads the ads created and where each one stands today in Brevo (the CRM), per account,
campaign and ad, so the team sees which ads produce real opportunities and which leads were never followed up.

## Decisions

| Topic | Decision |
|---|---|
| Lead source | LinkedIn Lead Sync API (`GET /rest/leadFormResponses?q=owner`), scope `r_marketing_leadgen_automation` on the existing app `78dwgxsz59rk7v` (granted 2026-10-14, new login done) |
| Status source | Brevo API v3: contacts, CRM deals, pipeline stages ("PGI Sales Pipeline") |
| Join | Lead email (form question with `predefinedField = EMAIL`) ↔ Brevo contact email, lower-cased, trimmed; in memory only |
| Statuses (ordered) | Not in Brevo → In Brevo, no deal → Cold → Warm → Hot → Won; Lost separate; **Unsubscribed** = flag (Brevo `emailBlacklisted`) |
| Several deals per contact | Most advanced counts: Won > Hot > Warm > Cold > Lost |
| Period semantics | Leads **created** in the period (LinkedIn `submittedAt`, UTC day), with their status **today** |
| Test leads | Excluded (`testLead = true`) |
| Visibility | Public dashboard, **aggregates only**; no name, email, phone, company or answer leaves the build |
| Small counts | Accepted by the owner on 2026-10-14: rows are per day × ad × status even when the count is 1 (incl. deals and unsubscribes). Re-identification needs outside knowledge of who filled which form when; no names/emails are published. Option to coarsen deal/unsubscribe rows to week × campaign was declined. |
| Placement | Overview block + new **Leads** tab |

## Data

New modules (stdlib only):
- `brevo.py` — Brevo client: `load_key()` (env `BREVO_API_KEY`, from `.env` locally / secret in CI), `get(path)`
  with retry on 429/5xx, `contacts()` (paged 1,000), `deals()` (paged 500), `stages()` → `{stage_id: name}`.
- `lead_status.py` — `fetch_leads(api, account_id)` (paged 200), `email_question_ids(api, form_ids)`,
  `lead_email(lead, email_qids)`, `contact_status(contact, deal_stages_by_contact)`,
  `aggregate(leads, contacts, deals, stages) -> list[row]`.

`build_data.py` adds `leadStatus` to `site/data.json`:

```json
"leadStatus": [{"date": "2026-09-30", "accountId": 547203257, "campaignId": 835504524, "adId": 1476910094,
                "status": "Warm", "count": 2, "unsubscribed": 0}]
```

- One row per (date, accountId, campaignId, adId, status) with `count ≥ 1`; `campaignId`/`adId` may be null
  (4 leads today have no campaign/ad); sorted by date then ids.
- `generatedAt` unchanged; nothing else personal is written. Emails are never written to disk or logs, hashed or not.
- Failure of Brevo or Lead Sync fails the run (no partial deploy), like other API errors.

## Overview additions

Directly under the story sentence:
1. **Second sentence:** "So far, 21 of them became deals in your CRM, and 3 are Hot." Variants: no deals →
   "None of them has become a deal in your CRM yet."; Won > 0 → "…, 3 are Hot and 1 was won."; no leads → omitted.
2. **Lead funnel strip:** Leads (forms) → In Brevo → Deals → Hot → Won, counts with ⓘ.
3. **Warning card** when Not in Brevo > 0: "⚠️ 42 leads from this period are not in Brevo yet, so nobody can
   follow them up." (link "See which campaigns →" opens the Leads tab).

## Leads tab

- **Funnel** (as above) with step rates ("91% reached Brevo", "7% became deals").
- **Leads per week by status** — stacked bars, one segment per status in funnel order, single-hue blue ramp
  (light = Not in Brevo … darkest = Won), Lost in neutral gray; legend + tooltip with all statuses and total.
  Weeks start Monday; partial first/last weeks allowed.
- **Table by campaign or by ad** (toggle): Name · Leads · Not in Brevo · No deal · Cold · Warm · Hot · Won · Lost ·
  Unsubscribed · Deals · Cost per deal (spend over the same period ÷ deals; "—" when 0). Sorted by deals, then leads.
  Totals row. Rows with 0 leads hidden.
- Empty state: "No leads in this period."
- Respects account / period / campaign filters.

## Glossary additions (ⓘ)

- Leads (forms): people who sent your LinkedIn form. Can differ slightly from the ad-reported leads because
  LinkedIn counts them separately.
- In Brevo: leads found in your Brevo contacts (matched by email).
- Deal: a lead with an opportunity in your Brevo sales pipeline (Cold, Warm, Hot, Won or Lost).
- Cost per deal: ad spend ÷ number of deals.
- Unsubscribed: leads who unsubscribed from your emails.

## CI

Secrets: add `BREVO_API_KEY`; replace `LKDN_REFRESH_TOKEN` and `LKDN_REFRESH_EXPIRES_AT` with the new login's values
(includes Lead Sync scope). Brevo IP blocking is disabled on the account (required for GitHub runners).

## Testing

- Python: email question detection, lead email extraction, status precedence (multiple deals, Lost vs Warm),
  Not in Brevo, unsubscribed flag, test leads excluded, null campaign/ad, aggregation keys and counts,
  paging of both APIs (mocked), no email in output (assert the serialised result contains no "@").
- JS: lead funnel totals and rates, second sentence variants, warning card condition, weekly status series,
  table rows per campaign/ad with cost per deal, filters by account/campaign/period.
- Browser: Overview block + Leads tab for 3CC / C2 / Both and several periods; totals consistent with the
  exploration (3CC 345 leads: 51 / 285 / 7 Warm / 2 Hot; C2 1,567: 157 / 1,398 / 4 Cold / 7 Warm / 1 Hot); dark mode,
  390 px, no console errors.

## Out of scope

Pushing missing leads into Brevo automatically, per-lead lists on the site, email engagement (opens/clicks),
event attendance, Google Ads leads.
