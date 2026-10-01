// App shell: state in the URL hash, header controls, tabs; delegates each tab to its module.
import * as M from "./metrics.js";
import { el, formatters } from "./ui.js";
import { renderOverview } from "./overview.js";
import { renderAds } from "./ads.js";
import { renderSheet } from "./sheet-view.js";

const TABS = ["overview", "ads", "sheet"];
const RANGES = ["7d", "30d", "month", "lastmonth", "ytd", "all"];
const LEVELS = ["total", "campaign", "ad"];
const state = { tab: "overview", account: "all", range: "30d", campaign: null, ad: null, level: "total", sort: "leads" };
let data, adsById, campaignsById, activeCampaignIds;
const $ = (id) => document.getElementById(id);
const numOrNull = (v) => (v ? Number(v) : null);

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (TABS.includes(p.get("tab"))) state.tab = p.get("tab");
  if (p.get("acc")) state.account = p.get("acc");
  if (RANGES.includes(p.get("range"))) state.range = p.get("range");
  if (LEVELS.includes(p.get("level"))) state.level = p.get("level");
  state.campaign = numOrNull(p.get("c"));
  state.ad = numOrNull(p.get("ad"));
}

function writeHash() {
  const p = new URLSearchParams({ tab: state.tab, acc: state.account, range: state.range });
  if (state.campaign) p.set("c", state.campaign);
  if (state.tab === "sheet") {
    p.set("level", state.level);
    if (state.ad) p.set("ad", state.ad);
  }
  history.replaceState(null, "", `#${p}`);
}

const selectedAccounts = () =>
  state.account === "all" ? data.accounts : data.accounts.filter((a) => a.label === state.account);

// Ads in scope for the account + campaign filters; drops filters that don't belong (e.g. shared links).
function selectedAds() {
  const accIds = new Set(selectedAccounts().map((a) => a.id));
  const ads = data.ads.filter((a) => accIds.has(a.accountId));
  if (state.campaign && !ads.some((a) => a.campaignId === state.campaign)) state.campaign = null;
  const scoped = state.campaign ? ads.filter((a) => a.campaignId === state.campaign) : ads;
  if (state.ad && !scoped.some((a) => a.id === state.ad)) state.ad = null;
  return scoped;
}

function renderHeader() {
  const labels = data.accounts.map((a) => a.label);
  if (labels.length > 1) labels.push("all");
  $("accounts").replaceChildren(...labels.map((label) => {
    const b = el("button", null, label === "all" ? (data.accounts.length === 2 ? "Both" : "All") : label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(state.account === label));
    b.onclick = () => { Object.assign(state, { account: label, campaign: null, ad: null }); render(); };
    return b;
  }));
  $("range").value = state.range;

  const accIds = new Set(selectedAccounts().map((a) => a.id));
  const options = data.campaigns
    .filter((c) => accIds.has(c.accountId) && activeCampaignIds.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  $("campaign").replaceChildren(new Option("All campaigns", ""), ...options.map((c) => new Option(c.name, c.id)));
  $("campaign").value = state.campaign ?? "";

  for (const t of TABS) {
    $(`tab-${t}`).setAttribute("aria-selected", String(state.tab === t));
    $(`panel-${t}`).hidden = state.tab !== t;
  }
}

function render() {
  const ads = selectedAds();
  renderHeader();
  const adIds = new Set(ads.map((a) => a.id));
  const today = M.todayIso();
  const firstDate = data.daily.find((r) => adIds.has(r.adId))?.date || today;
  const range = M.rangeFor(state.range, today, firstDate);
  const ctx = {
    data, state, range, days: M.daysInclusive(range.start, range.end),
    rows: M.filterRows(data.daily, range, adIds),
    prevRows: M.filterRows(data.daily, M.previousRange(range), adIds),
    f: formatters(selectedAccounts()[0]?.currency || "EUR"),
    adsById, campaignsById,
  };
  if (state.tab === "overview") renderOverview(ctx);
  if (state.tab === "ads") {
    renderAds(ctx, {
      onSort: (sort) => { state.sort = sort; render(); },
      onSeeDaily: (id) => { Object.assign(state, { tab: "sheet", level: "ad", ad: id }); render(); window.scrollTo(0, 0); },
    });
  }
  if (state.tab === "sheet") {
    renderSheet(ctx, {
      onLevel: (level) => { state.level = level; render(); },
      onClearAd: () => { state.ad = null; render(); },
    });
  }
  writeHash();
}

async function init() {
  readHash();
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    $("error").textContent = `Could not load the data (${e.message}). The next scheduled refresh should fix this.`;
    $("error").hidden = false;
    $("updated").textContent = "";
    document.body.classList.remove("loading");
    return;
  }
  adsById = new Map(data.ads.map((a) => [a.id, a]));
  campaignsById = new Map(data.campaigns.map((c) => [c.id, c]));
  activeCampaignIds = new Set(data.daily.map((r) => r.campaignId));
  const labels = data.accounts.map((a) => a.label);
  if (labels.length === 1) state.account = labels[0];
  else if (!labels.includes(state.account)) state.account = "all";

  $("updated").textContent = `Updated ${new Date(data.generatedAt).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`;
  $("range").onchange = (e) => { state.range = e.target.value; render(); };
  $("campaign").onchange = (e) => { state.campaign = numOrNull(e.target.value); state.ad = null; render(); };
  for (const t of TABS) $(`tab-${t}`).onclick = () => { state.tab = t; render(); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  document.body.classList.remove("loading");
  render();
}

init();
