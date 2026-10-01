# LinkedIn Ads Dashboard — Design

Date: 2026-10-01
Status: approved in conversation, pending written-spec review

## Goal

A public, auto-refreshing dashboard of LinkedIn Ads performance for two ad accounts,
hosted on GitHub Pages. It answers: how many leads are we getting, at what cost, and
which campaigns drive them — plus the impression → click → lead funnel behind them.

## Decisions

| Topic | Decision |
|---|---|
| Destination | GitHub Pages, **public** (accepted: anyone with the link sees spend & campaign names) |
| Google Sheet | Dropped |
| Accounts | 3 Comma Capital (`547203257`, label "3CC") and C2Capital (`515707132`, label "C2"), both EUR |
| LinkedIn app | One app (the 3CC app, `LKDN_CLIENT_ID`) and one member login read both accounts — verified 2026-10-01. The separate C2 app credentials are not used. |
| Refresh | GitHub Actions cron every 3 hours + manual "Run workflow" button |
| Architecture | Option 1: each run re-pulls full history, writes `data.json`, deploys `site/` as a Pages artifact. No data commits. |
| Budget tracking | Out of scope (daily budget shown as a table column only) |
| Repo | Standalone repo `beafb/linkedin-ads-dashboard`, separate from the `C2Cap` folder (which holds lead CSVs with personal data that must never be published) |

## Architecture

```
linkedin_ads.py               # API client: OAuth login, token refresh, fetch helpers, local CSV pull
build_data.py                 # pulls every account in accounts.json → site/data.json
accounts.json                 # [{"id": 547203257, "label": "3CC"}, {"id": 515707132, "label": "C2"}]
site/index.html               # the dashboard (static, Chart.js from cdnjs)
.github/workflows/refresh.yml # cron + manual trigger → build → deploy Pages
tests/                        # unit tests for transformation + token logic (stdlib unittest)
README.md                     # setup, secrets, yearly re-login procedure
```

Python stays stdlib-only (no `pip install` locally or in CI).

### Credentials

- Local: `.env` (gitignored) with `LKDN_CLIENT_ID`, `LKDN_PRIMARY_CLIENT_SECRET`; tokens in
  `.linkedin_tokens.json` (gitignored, mode 600).
- CI: GitHub repository secrets `LKDN_CLIENT_ID`, `LKDN_PRIMARY_CLIENT_SECRET`,
  `LKDN_REFRESH_TOKEN`, `LKDN_REFRESH_EXPIRES_AT` (unix timestamp, for the expiry warning).
- `linkedin_ads.py` gains: when `LKDN_REFRESH_TOKEN` is set in the environment, it exchanges it
  for an access token in memory and writes nothing to disk.
- LinkedIn refresh tokens keep a fixed 365-day lifetime from the original login (current one
  expires ~2027-09-30); refreshing does not extend it. A yearly `python3 linkedin_ads.py auth`
  + updating the secret is required.

## Data flow (one run)

1. Obtain access token from refresh token.
2. For each account in `accounts.json`:
   - `GET /rest/adAccounts/{id}` → name, currency
   - `GET /rest/adAccounts/{id}/adCampaignGroups?q=search` → groups
   - `GET /rest/adAccounts/{id}/adCampaigns?q=search` → campaigns
   - `GET /rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY` from the earliest
     campaign `runSchedule.start` to today.
3. Write `site/data.json`:

```json
{
  "generatedAt": "2026-10-01T14:05:00Z",
  "accounts": [{"id": 547203257, "label": "3CC", "name": "3 Comma Capital", "currency": "EUR"}],
  "campaigns": [{"id": 1, "accountId": 547203257, "name": "C2-like", "group": "LG-NMonnier-1307",
                 "status": "ACTIVE", "objective": "LEAD_GENERATION", "dailyBudget": 100}],
  "daily": [{"date": "2026-09-30", "campaignId": 1, "impressions": 0, "clicks": 0,
             "landingPageClicks": 0, "spend": 0.0, "leadFormOpens": 0, "leads": 0,
             "engagements": 0}]
}
```

`daily` uses short keys mapped from LinkedIn fields: `spend` ← `costInLocalCurrency` (string → float),
`leadFormOpens` ← `oneClickLeadFormOpens`, `leads` ← `oneClickLeads`, `engagements` ← `totalEngagements`.
Rows whose campaign is missing from the campaign list are kept with `name` = campaign id.

4. Deploy `site/` (index.html + data.json) with `actions/upload-pages-artifact` + `actions/deploy-pages`.

## Dashboard (site/index.html)

**Header:** account switcher **3CC | C2 | Both** (Both sums; both EUR) · date range presets
(last 7 d, last 30 d [default], this month, last month, year to date, all time) · "Last updated" time.
Selections are kept in the URL hash so a view can be shared.

**1. Lead performance (top)**
- KPI tiles: Leads · Cost per lead · Spend · Lead-form completion rate (leads ÷ form opens),
  each with delta vs. the previous period of equal length.
- Daily chart: leads (bars) + cost per lead (line, second axis).

**2. Funnel**
- Impressions → Clicks → Lead-form opens → Leads with step conversion rates.
- KPI tiles: CTR, CPC, CPM.
- Daily chart: impressions + clicks.

**3. Campaign table**
- Columns: campaign, group, status, daily budget, impressions, clicks, CTR, spend, leads, CPL.
- Sortable; default sort spend desc; campaigns with zero impressions in range hidden.
- Clicking a row filters the whole page to that campaign (clear chip to reset).

**Metric definitions:** CTR = clicks ÷ impressions; CPC = spend ÷ clicks; CPM = spend ÷ impressions × 1000;
CPL = spend ÷ leads. Division by zero renders "—".

**Look:** light/dark following system, single page, works at phone width, Chart.js via cdnjs.

## Error handling

- Any API error (after the existing retry on 429/5xx) fails the run → nothing is deployed, the
  last good site stays live, GitHub emails the repo owner.
- Refresh token rejected → run fails with message pointing to the README re-login section.
- Fewer than 30 days left on `LKDN_REFRESH_EXPIRES_AT` → `::warning::` annotation on the run.
- `data.json` fails to load in the browser → page shows an inline error instead of empty charts.

## Testing

- Unit tests (`python3 -m unittest`): LinkedIn element → `daily` row mapping, campaign/group name
  joins, date-range start derivation, refresh-token-from-env path (HTTP mocked).
- Local end-to-end: `python3 build_data.py` against the real API, then serve `site/` with
  `python3 -m http.server` and check the page in a browser (both accounts, Both, each range,
  campaign filter, dark mode, phone width).
- After first deploy: trigger the workflow manually and confirm the Pages URL shows current data.

## Out of scope

Budget tracking/pacing, demographic pivots (job title, company), creative-level reporting,
Google Sheets export, Lead Sync API.
