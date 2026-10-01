# LinkedIn Ads Dashboard v2 — Design

Date: 2026-10-01
Status: approved in conversation, pending written-spec review
Builds on: `2026-10-01-linkedin-ads-dashboard-design.md` (v1, live). Everything not changed here stays as in v1
(hosting, 3-hour refresh, secrets, public site, single LinkedIn login, light/dark).

## Goal

Make the dashboard understandable and impressive for people who don't know ads:
it tells the story in plain English, shows each ad's results with a verdict, and offers a
spreadsheet-like daily view.

## Decisions

| Topic | Decision |
|---|---|
| Audience | One team managing both accounts → single page with 3CC / C2 / Both switch (unchanged) |
| Language | English, plain words, every technical term has an ⓘ explanation |
| Ad visuals | None. LinkedIn post content needs the Community Management API (403 today); `adPreviews` returns 422 for these ads. Ads are shown as cards without images. |
| Structure | One page, three tabs: **Overview · Ads · Daily sheet** |
| Data grain | One daily row **per ad** (adAnalytics `pivot=CREATIVE`); campaign and account totals are sums of ad rows |

## Data (`build_data.py` → `site/data.json`)

Per account:
- `GET /rest/adAccounts/{id}` (name, currency), campaign groups, campaigns — as v1.
- `GET /rest/adAccounts/{id}/creatives?q=criteria` (paged) → ads.
- `GET /rest/adAnalytics?q=analytics&pivot=CREATIVE&timeGranularity=DAILY` in 90-day chunks from the earliest
  campaign start to today, same metric fields as v1.

```json
{
  "generatedAt": "2026-10-01T14:29:31+00:00",
  "accounts":  [{"id": 547203257, "label": "3CC", "name": "3 Comma Capital", "currency": "EUR"}],
  "campaigns": [{"id": 835504524, "accountId": 547203257, "name": "C2-like", "group": "LG-NMonnier-1307",
                 "status": "ACTIVE", "objective": "LEAD_GENERATION", "dailyBudget": 100.0}],
  "ads":       [{"id": 1476910094, "accountId": 547203257, "campaignId": 835504524, "name": "Ad_1_28Jul2026",
                 "status": "Running", "createdAt": "2026-07-28"}],
  "daily":     [{"date": "2026-09-30", "adId": 1476910094, "campaignId": 835504524, "impressions": 0,
                 "clicks": 0, "landingPageClicks": 0, "spend": 0.0, "leadFormOpens": 0, "leads": 0,
                 "engagements": 0}]
}
```

- Ad `status` (display string) from `intendedStatus` + `isServing`:
  ACTIVE+serving → "Running"; ACTIVE+not serving → "Not delivering"; PAUSED → "Paused";
  ARCHIVED / CANCELED / COMPLETED → "Ended"; DRAFT → "Draft"; anything else → title-cased value.
- Ad `name`: creative `name`, else `"Ad <id>"`.
- Analytics rows for an ad missing from the creatives list get a stub ad (`name` "Ad <id>", status "Ended",
  `campaignId` null) and are still counted; their `campaignId` in `daily` is null.
- Metric parsing as v1 (spend string → float rounded to cents; missing → 0).

## Header (all tabs)

Account switch (3CC | C2 | Both) · Period (7d, 30d default, this month, last month, year to date, all time) ·
**Campaign** dropdown (All campaigns + campaigns of the selected account(s) that have activity in data) ·
"Updated <date time>" · tabs. All state in the URL hash:
`#tab=overview|ads|sheet&acc=…&range=…&c=<campaignId>&ad=<adId>&level=total|campaign|ad`.
Changing account resets campaign and ad filters; changing campaign resets the ad filter.

## Tab 1 — Overview

1. **Story sentence**, generated:
   "In the last 30 days, your ads were seen 150,574 times, 3,036 people clicked and 354 became leads,
   at €17.05 each (16% more than the previous 30 days)."
   Period phrase per preset: "In the last 7 days", "In the last 30 days", "This month", "Last month",
   "This year", "Since the start". The comparison clause is omitted when there is no previous-period value;
   "more"/"less" by sign; "the same as" when the change rounds to 0%.
   No activity → "No ads ran in this period."
2. **Four headline tiles** (count-up animation, ~600 ms, skipped when `prefers-reduced-motion`):
   Leads · Cost per lead · Spend · Seen by (impressions). Each with ⓘ, and delta line
   "▲ 4% vs previous 30 days"; green = better, red = worse (cost per lead: lower is better; spend: neutral);
   0% shows "= same as previous …" neutral.
3. **Three highlight cards:**
   - 🥇 Best ad — most leads in period (tie → lower cost per lead); shows name, leads, cost per lead; hidden if no leads.
   - 📅 Best day — date with most leads; "Tuesday 22 Sept · 22 leads"; hidden if no leads.
   - 📈 Trend — one sentence comparing leads and cost per lead with the previous period;
     "Not enough history to compare" if no previous data.
4. **"Out of 1,000 people who saw your ads…"** — clicks, form opens and leads per 1,000 impressions
   (one decimal below 10), shown as four steps with plain captions. Hidden when impressions = 0.
5. **Two charts:** Leads per day (bars), Cost per lead per day (line, gaps on days without leads).

## Tab 2 — Ads

- Card grid of ads with ≥ 1 impression in the period (respecting account/campaign filters).
- Sort select: Most leads (default) · Cheapest leads · Most spend · Newest.
- Card content: 🥇🥈🥉 for top 3 by leads (only ads with ≥ 1 lead; based on leads ranking regardless of sort);
  name; campaign name · status pill; big "**300 leads**"; "**€15.72 per lead**" (or "No leads yet");
  small row: Seen by · Clicks · Click rate · Spend; sparkline of daily leads over the period (single series, no axes,
  tooltip-free, `aria-hidden` — numbers are in the card); verdict badge; link "See daily numbers →"
  (switches to sheet with `level=ad&ad=<id>`).
- **Verdict** (icon + text, never colour alone), with `avgCpl` = spend ÷ leads over all ads in the current selection:
  1. impressions < 1,000 → ⏳ Too early to tell
  2. leads = 0 → 👀 Seen but not converting
  3. avgCpl is null → ✅ Solid
  4. cpl ≤ 0.8 × avgCpl → ⭐ Star performer
  5. cpl ≥ 1.5 × avgCpl → ⚠️ Costly leads
  6. otherwise → ✅ Solid
- Each verdict has an ⓘ sentence (e.g. "Costly leads: each lead costs at least 50% more than your average").
- Empty state: "No ads ran in this period."

## Tab 3 — Daily sheet

- Level select: All combined (default) · By campaign · By ad. An `ad` filter (from a card link) shows a chip
  "Ad: <name> ✕" and limits rows to that ad.
- Rows: one per day (All combined: every day in the period, zeros included) or per day × campaign/ad with activity
  (impressions > 0). Newest first.
- Columns: Date · [Campaign | Ad] · Seen by · Clicks · Click rate · Form opens · Leads · Spend · Cost per lead.
  Header ⓘ on each metric.
- Totals row directly under the header, sticky while scrolling.
- Leads cells shaded with a sequential blue ramp (5 steps, light → dark relative to the max in view, 0 = no shading);
  text stays in text colours with sufficient contrast.
- "Download CSV" exports the rows in view (plus totals) with raw numbers (no currency symbols), ISO dates,
  filename `linkedin-ads-<acc>-<start>-<end>.csv`.
- Phone: horizontal scroll inside the table, Date column sticky.

## Glossary (ⓘ texts)

- Seen by (impressions): how many times your ads were shown on screen.
- Clicks: how many times someone clicked your ad.
- Click rate (CTR): out of 100 people who saw the ad, how many clicked.
- Form opens: how many people opened your lead form.
- Leads: people who filled in and sent your form.
- Cost per lead: what you paid on average for each lead (spend ÷ leads).
- Spend: what LinkedIn charged for the period.
- Form completion: out of 100 people who opened the form, how many sent it.

ⓘ opens on hover and on tap/focus (button with `aria-describedby` tooltip), closes on Escape / tap elsewhere.

## Polish

Skeleton placeholders while `data.json` loads; tab switch without page reload; count-up on tiles;
cards one per row under 640 px; dark mode as v1; no dual-axis charts; all untrusted strings via `textContent`.
Also folded in from v1 deferred minors because they touch the same code: 0% delta neutral, timezone label on
"Updated", "All time" starts at the first date of the selected accounts, chip/filters ignored when they don't
belong to the selected account.

## Error handling

As v1. Additionally: creatives request failure fails the run (no partial deploy).

## Testing

- Python unit tests: creative → ad mapping and status rules, stub ads for orphan analytics rows,
  `pivot=CREATIVE` chunked queries, daily rows carry `adId` and `campaignId`.
- JS unit tests (`node --test`): story sentence (all presets, no activity, no previous period, same/more/less),
  verdict rules (each branch + boundaries 0.8× and 1.5×, null avg), top-3 medals, best day, per-1,000 funnel,
  sheet rows for each level (zero-filled days for total, totals row), CSV output (escaping of commas/quotes in names),
  campaign/ad filters.
- Browser check: each tab × account × a few ranges, ⓘ on hover and keyboard, card link → sheet, CSV download,
  dark mode, 390 px width, no console errors.

## Out of scope

Ad images/previews, French translation, per-client pages, demographics, budget pacing.
