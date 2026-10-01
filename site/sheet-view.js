// Daily sheet tab: spreadsheet-like table with totals, leads shading and CSV download.
import * as S from "./sheet.js";
import { el, info, GLOSSARY } from "./ui.js";

const $ = (id) => document.getElementById(id);

const COLS = [
  { key: "impressions", label: "Seen by", fmt: "num" },
  { key: "clicks", label: "Clicks", fmt: "num" },
  { key: "ctr", label: "Click rate", fmt: "pct" },
  { key: "leadFormOpens", label: "Form opens", fmt: "num" },
  { key: "leads", label: "Leads", fmt: "num" },
  { key: "spend", label: "Spend", fmt: "money" },
  { key: "cpl", label: "Cost per lead", fmt: "money" },
];
const LABEL_COL = { campaign: "Campaign", ad: "Ad" };

function rowEl(r, dateText, hasLabel, f, maxLeads) {
  const tr = el("tr");
  tr.append(el("td", "col-date", dateText));
  if (hasLabel) tr.append(el("td", "col-label", r.label ?? ""));
  for (const c of COLS) {
    const td = el("td", null, f[c.fmt](r[c.key]));
    if (c.key === "leads") {
      const step = S.shadeStep(r.leads, maxLeads);
      if (step) td.classList.add(`shade-${step}`);
    }
    tr.append(td);
  }
  return tr;
}

export function renderSheet({ rows, range, state, f, adsById, campaignsById }, { onLevel, onClearAd }) {
  const ad = state.ad ? adsById.get(state.ad) : null;
  const scoped = ad ? rows.filter((r) => r.adId === ad.id) : rows;
  const level = state.level;
  const nameOf = level === "campaign"
    ? (id) => campaignsById.get(id)?.name || "Unknown campaign"
    : (id) => adsById.get(id)?.name || `Ad ${id}`;
  const result = S.sheetRows(scoped, range, level, nameOf);
  const hasLabel = level !== "total";

  $("level").value = level;
  $("level").onchange = (e) => onLevel(e.target.value);
  const chip = $("ad-chip");
  chip.hidden = !ad;
  if (ad) { chip.textContent = `Ad: ${ad.name} ✕`; chip.onclick = onClearAd; }

  const head = el("tr");
  head.append(el("th", "col-date", "Date"));
  if (hasLabel) head.append(el("th", "col-label", LABEL_COL[level]));
  for (const c of COLS) {
    const th = el("th", null, c.label);
    th.append(info(GLOSSARY[c.key]));
    head.append(th);
  }
  const totalRow = rowEl({ ...result.total, label: "" }, "Total", hasLabel, f, 0);
  totalRow.className = "totals";
  $("sheet").tHead.replaceChildren(head, totalRow);

  const maxLeads = Math.max(0, ...result.rows.map((r) => r.leads));
  $("sheet").tBodies[0].replaceChildren(...result.rows.map((r) => rowEl(r, f.sheetDay(r.date), hasLabel, f, maxLeads)));
  $("sheet-empty").hidden = result.rows.some((r) => r.impressions > 0);

  $("csv").onclick = () => {
    const a = document.createElement("a");
    // French-locale Excel splits on ";" and reads "," as the decimal mark
    const opts = /^fr\b/i.test(navigator.language) ? { sep: ";", decimal: "," } : {};
    a.href = URL.createObjectURL(new Blob(["\ufeff", S.sheetCsv(result, level, opts)], { type: "text/csv;charset=utf-8" }));
    a.download = `linkedin-ads-${state.account}-${range.start}-${range.end}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}
