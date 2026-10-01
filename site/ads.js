// Ads tab: one card per ad with results, verdict, medal and a leads sparkline.
import * as M from "./metrics.js";
import * as I from "./insights.js";
import { el, info, sparkline } from "./ui.js";

const $ = (id) => document.getElementById(id);

function sortAds(list, sort, adsById) {
  const copy = [...list];
  if (sort === "cheapest") return copy.sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity) || b.leads - a.leads);
  if (sort === "spend") return copy.sort((a, b) => b.spend - a.spend);
  if (sort === "newest") {
    const created = (a) => adsById.get(a.id)?.createdAt || "";
    return copy.sort((a, b) => created(b).localeCompare(created(a)));
  }
  return I.byLeads(copy);
}

function adCard(a, ad, campaign, medal, verdictKey, sparkValues, f, onSeeDaily) {
  const card = el("article", "ad-card");
  const top = el("div", "ad-top");
  if (medal) top.append(el("span", "medal", medal));
  top.append(el("h3", "ad-name", ad?.name || `Ad ${a.id}`));

  const status = ad?.status || "Ended";
  const meta = el("div", "ad-meta", campaign?.name || "Unknown campaign");
  meta.append(el("span", `pill pill-${status.toLowerCase().replace(/\s+/g, "-")}`, status));

  const big = el("div", "ad-big");
  big.append(el("strong", null, `${f.num(a.leads)} ${a.leads === 1 ? "lead" : "leads"}`),
    el("span", null, a.cpl == null ? "No leads yet" : `${f.money(a.cpl)} per lead`));

  const stats = el("dl", "ad-stats");
  for (const [label, value] of [["Seen by", f.num(a.impressions)], ["Clicks", f.num(a.clicks)],
    ["Click rate", f.pct(a.ctr)], ["Spend", f.money(a.spend)]]) {
    const item = el("div");
    item.append(el("dt", null, label), el("dd", null, value));
    stats.append(item);
  }

  const spark = el("div", "spark-wrap");
  spark.append(el("span", "spark-label", "Leads per day"), sparkline(sparkValues));

  const v = I.VERDICTS[verdictKey];
  const verdict = el("div", `verdict verdict-${verdictKey}`, `${v.icon} ${v.label}`);
  verdict.append(info(v.help));

  const link = el("button", "link", "See daily numbers →");
  link.type = "button";
  link.onclick = () => onSeeDaily(a.id);

  card.append(top, meta, big, stats, spark, verdict, link);
  return card;
}

export function renderAds({ rows, range, state, f, adsById, campaignsById }, { onSort, onSeeDaily }) {
  $("ad-sort").value = state.sort;
  $("ad-sort").onchange = (e) => onSort(e.target.value);
  const list = I.adList(rows).filter((a) => a.impressions > 0);
  const avgCpl = M.ratios(M.totals(rows)).cpl;
  const medal = I.medals(list);
  $("ads-empty").hidden = list.length > 0;
  $("ads-grid").replaceChildren(...sortAds(list, state.sort, adsById).map((a) => {
    const ad = adsById.get(a.id);
    const spark = M.byDate(rows.filter((r) => r.adId === a.id), range).map((d) => d.leads);
    return adCard(a, ad, campaignsById.get(ad?.campaignId), medal.get(a.id), I.verdict(a, avgCpl), spark, f, onSeeDaily);
  }));
}
