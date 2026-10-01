# LinkedIn Ads Dashboard

Public dashboard of LinkedIn Ads lead performance for the 3CC and C2 ad accounts.
GitHub Actions pulls the LinkedIn Marketing API every 3 hours and publishes `site/` to GitHub Pages.

## How it works

- `linkedin_ads.py` — LinkedIn API client (OAuth login, token refresh, local CSV pull).
- `build_data.py` — pulls every account in `accounts.json` → `site/data.json` (campaigns, ads, daily numbers per ad).
- `site/` — the static page: `metrics.js`, `insights.js`, `sheet.js` = calculations (unit-tested);
  `app.js` (state, header, tabs), `overview.js`, `ads.js`, `sheet-view.js`, `ui.js` = rendering. Chart.js from cdnjs.
- `.github/workflows/refresh.yml` — tests, pulls data, deploys. Runs every 3 h, on push, or via *Actions → Refresh dashboard → Run workflow*.

## Local development

```bash
# .env needs LKDN_CLIENT_ID and LKDN_PRIMARY_CLIENT_SECRET
python3 linkedin_ads.py auth        # once: browser login, saves .linkedin_tokens.json
python3 build_data.py               # writes site/data.json
python3 -m http.server 8000 -d site # open http://localhost:8000
python3 -m unittest discover -s tests -t . && node --test tests/*.test.mjs
```

The LinkedIn app must list `http://localhost:8765/callback` under *Auth → Authorized redirect URLs*.

## Adding an ad account

Add `{"id": <account id>, "label": "<short name>"}` to `accounts.json` and push.
`python3 linkedin_ads.py accounts` lists the IDs the login can see.

## First-time GitHub setup (in this order)

1. Create the repo and set the four secrets below (`gh secret set ...`).
2. Settings → Pages → Source: **GitHub Actions**.
3. Push to `main` (or *Run workflow*). A push before steps 1–2 fails with
   "Missing LKDN_CLIENT_ID (.env locally, repository secret in CI)" or at "configure-pages".

## GitHub secrets

| Secret | Value |
|---|---|
| `LKDN_CLIENT_ID` | app client ID |
| `LKDN_PRIMARY_CLIENT_SECRET` | app client secret |
| `LKDN_REFRESH_TOKEN` | `refresh_token` from `.linkedin_tokens.json` |
| `LKDN_REFRESH_EXPIRES_AT` | `refresh_expires_at` from `.linkedin_tokens.json` (unix time) |

## Yearly re-login

LinkedIn refresh tokens last 365 days from the login and are not extended by use.
About 30 days before expiry the workflow shows a warning; after expiry runs fail with
"refresh token rejected or expired". To renew:

```bash
python3 linkedin_ads.py auth
python3 -c "import json;print(json.load(open('.linkedin_tokens.json'))['refresh_token'],end='')" | gh secret set LKDN_REFRESH_TOKEN
python3 -c "import json;print(json.load(open('.linkedin_tokens.json'))['refresh_expires_at'],end='')" | gh secret set LKDN_REFRESH_EXPIRES_AT
gh workflow run refresh.yml
```

## Privacy

This site is public: anyone with the URL sees spend, leads and campaign names. Lead contact
details are never pulled or published.
