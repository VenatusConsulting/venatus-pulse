const STORAGE_ACCOUNTS = "signal_accounts";
const STORAGE_ENTRIES = "signal_entries";
const STORAGE_CONVERSIONS = "signal_conversions";
const STORAGE_TAG_VOCAB = "signal_tag_vocab";

// one color per channel — reused consistently across chips, pulse traces and charts
const CHANNEL_COLORS = ["#e8a94a", "#e2735a", "#d97bc4", "#7fbd8a", "#7c93e0", "#4fc2b0"];

const CATEGORY_LABELS = { trafic: "Trafic", creatrice: "Créatrice" };

// structured content taxonomy — predefined lists stay hardcoded so future default
// changes aren't shadowed by stale localStorage; users can extend via signal_tag_vocab
const TAG_AXES = ["hook", "format", "longueur", "cta", "son"];
const TAG_UNCLASSIFIED = "Non classé";
const TAG_AXIS_LABELS = { hook: "Hook", format: "Format", longueur: "Longueur", cta: "CTA", son: "Son" };
const PREDEFINED_TAGS = {
  hook: ["Question", "Pattern interrupt", "Storytime", "POV", "Avant/Après", "Statistique choc", "Controverse", "Autre"],
  format: ["Talking head", "Voix off", "Greenscreen", "Transition", "Texte à l'écran", "Duo/Stitch", "Autre"],
  longueur: ["<15s", "15-30s", "30-60s", "60s+"],
  cta: ["Lien en bio", "Commente pour", "Abonne-toi", "DM-moi", "Aucun"],
  son: ["Audio tendance", "Musique originale", "Voix seule", "Silence"],
};

// --- storage --------------------------------------------------------

function loadAccounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_ACCOUNTS)) || [];
    // normalize: any account missing (or with an invalid) category defaults to "trafic",
    // and niche defaults to "" — so pre-existing data keeps working without loss.
    return raw.map((a) => ({
      ...a,
      category: a.category === "creatrice" ? "creatrice" : "trafic",
      niche: typeof a.niche === "string" ? a.niche : "",
    }));
  } catch {
    return [];
  }
}
function saveAccounts(accounts) {
  localStorage.setItem(STORAGE_ACCOUNTS, JSON.stringify(accounts));
}

function migrateEntry(e) {
  const tags = e.tags && typeof e.tags === "object" ? e.tags : {};
  return {
    id: e.id,
    accountId: e.accountId,
    date: e.date,
    // old free-text `variant` becomes `label` verbatim — nothing is discarded
    label: e.label !== undefined ? e.label : e.variant || "",
    tags: {
      hook: tags.hook || TAG_UNCLASSIFIED,
      format: tags.format || TAG_UNCLASSIFIED,
      longueur: tags.longueur || TAG_UNCLASSIFIED,
      cta: tags.cta || TAG_UNCLASSIFIED,
      son: tags.son || TAG_UNCLASSIFIED,
    },
    views: e.views,
    likes: e.likes,
    comments: e.comments,
    shares: e.shares,
    notes: e.notes,
  };
}
function loadEntries() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_ENTRIES)) || [];
    return raw.map(migrateEntry);
  } catch {
    return [];
  }
}
function saveEntries(entries) {
  localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(entries));
}

function loadConversions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CONVERSIONS)) || [];
  } catch {
    return [];
  }
}
function saveConversions(conversions) {
  localStorage.setItem(STORAGE_CONVERSIONS, JSON.stringify(conversions));
}

function loadTagVocab() {
  const vocab = {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_TAG_VOCAB)) || {};
    TAG_AXES.forEach((axis) => {
      vocab[axis] = Array.isArray(raw[axis]) ? raw[axis] : [];
    });
  } catch {
    TAG_AXES.forEach((axis) => {
      vocab[axis] = [];
    });
  }
  return vocab;
}
function saveTagVocab(vocab) {
  localStorage.setItem(STORAGE_TAG_VOCAB, JSON.stringify(vocab));
}

let accounts = loadAccounts();
let entries = loadEntries();
let conversions = loadConversions();
let tagVocab = loadTagVocab();

let variantChart = null;
let trendChart = null;
let insightsCharts = {}; // { hook: Chart, format: Chart, ... }
let conversionChart = null;

// which category is currently shown in the sidebar + Pouls des comptes
let categoryFilter = "all";
// which category will be assigned to the next account created
let newAccountCategory = "trafic";

// Insights section state
let insightsCategoryFilter = "all";
let insightsNicheFilter = "all";
let insightsMetric = "views"; // "views" | "engagement"
let insightsSort = "views"; // "views" | "engagement"

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function accountName(id) {
  const acc = accounts.find((a) => a.id === id);
  return acc ? acc.name : "?";
}

function channelColor(accountId) {
  const idx = accounts.findIndex((a) => a.id === accountId);
  return CHANNEL_COLORS[(idx < 0 ? 0 : idx) % CHANNEL_COLORS.length];
}

function accountsInCategory(category) {
  return category === "all" ? accounts : accounts.filter((a) => a.category === category);
}

function escapeHtml(str) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str ?? "").replace(/[&<>"']/g, (c) => map[c]);
}

function formatCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return (v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1).replace(".0", "") + "M";
  if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1).replace(".0", "") + "k";
  return String(v);
}

function formatPercent(x) {
  return (x * 100).toFixed(1).replace(".0", "") + "%";
}

function engagementRate(e) {
  const views = Number(e.views || 0);
  if (views <= 0) return 0;
  const engaged = Number(e.likes || 0) + Number(e.comments || 0) + Number(e.shares || 0);
  return engaged / views;
}

function entryLabel(e) {
  if (e.label && e.label.trim()) return e.label.trim();
  const tags = e.tags || {};
  const meaningful = TAG_AXES.map((axis) => tags[axis]).filter((t) => t && t !== TAG_UNCLASSIFIED);
  return meaningful.length ? meaningful.join(" · ") : "(sans label)";
}

function tagChipsHtml(tags) {
  if (!tags) return "";
  const chips = TAG_AXES.map((axis) => tags[axis]).filter((t) => t && t !== TAG_UNCLASSIFIED);
  if (chips.length === 0) return "";
  return `<div class="tag-chip-row">${chips.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</div>`;
}

function nicheOptions() {
  const set = new Set();
  accounts.forEach((a) => {
    if (a.niche && a.niche.trim()) set.add(a.niche.trim());
  });
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

// --- tag vocabulary (predefined + custom, persisted) ---------------------

function tagOptionsFor(axis) {
  const predefined = PREDEFINED_TAGS[axis] || [];
  const custom = tagVocab[axis] || [];
  const seen = new Set([TAG_UNCLASSIFIED.toLowerCase()]);
  const options = [TAG_UNCLASSIFIED];
  [...predefined, ...custom].forEach((t) => {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      options.push(t);
    }
  });
  return options;
}

function addCustomTag(axis, value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return false;
  const existing = tagOptionsFor(axis).map((t) => t.toLowerCase());
  if (existing.includes(trimmed.toLowerCase())) return false;
  tagVocab[axis] = [...(tagVocab[axis] || []), trimmed];
  saveTagVocab(tagVocab);
  return true;
}

// --- daily conversion log (per account, per day — upsert) ----------------

function upsertConversion(accountId, date, linkClicks, newSubs, revenue) {
  const existing = conversions.find((c) => c.accountId === accountId && c.date === date);
  if (existing) {
    existing.linkClicks = linkClicks;
    existing.newSubs = newSubs;
    existing.revenue = revenue;
  } else {
    conversions.push({ id: uid(), accountId, date, linkClicks, newSubs, revenue });
  }
  saveConversions(conversions);
}

// --- segmented controls (category filter + new-account category picker) ---

function setupSegmented(containerId, onSelect) {
  const container = document.getElementById(containerId);
  const buttons = [...container.querySelectorAll(".segmented-option")];
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      onSelect(btn.dataset.category);
    });
  });
}

// --- account management ----------------------------------------------

function renderAccountChips() {
  const wrap = document.getElementById("account-chips");
  wrap.innerHTML = "";

  if (accounts.length === 0) {
    const p = document.createElement("span");
    p.className = "signal-empty";
    p.textContent = "Aucun canal actif. Ajoute un compte ci-dessous.";
    wrap.appendChild(p);
    return;
  }

  const visible = accountsInCategory(categoryFilter);
  if (visible.length === 0) {
    const p = document.createElement("span");
    p.className = "signal-empty";
    p.textContent = "Aucun compte dans cette catégorie.";
    wrap.appendChild(p);
    return;
  }

  visible.forEach((acc) => {
    const chip = document.createElement("span");
    chip.className = "account-chip";
    const dot = document.createElement("span");
    dot.className = "chip-dot";
    dot.style.background = channelColor(acc.id);
    const label = document.createElement("span");
    label.textContent = acc.name;
    const badge = document.createElement("span");
    badge.className = `cat-badge cat-${acc.category}`;
    badge.textContent = CATEGORY_LABELS[acc.category];
    const parts = [dot, label, badge];
    if (acc.niche) {
      const niche = document.createElement("span");
      niche.className = "chip-niche";
      niche.textContent = acc.niche;
      parts.push(niche);
    }
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Supprimer ce compte (garde ses entrées dans le journal)";
    del.addEventListener("click", () => {
      accounts = accounts.filter((a) => a.id !== acc.id);
      saveAccounts(accounts);
      renderAll();
    });
    chip.append(...parts, del);
    wrap.appendChild(chip);
  });
}

function populateAccountSelects() {
  const entrySelect = document.getElementById("entry-account");
  const chartFilter = document.getElementById("chart-account-filter");
  const logFilter = document.getElementById("log-account-filter");
  const conversionFormAccount = document.getElementById("conversion-form-account");
  const conversionFilter = document.getElementById("conversion-account-filter");

  const prevEntry = entrySelect.value;
  const prevChart = chartFilter.value;
  const prevLog = logFilter.value;
  const prevConversionForm = conversionFormAccount.value;
  const prevConversionFilter = conversionFilter.value;

  entrySelect.innerHTML = "";
  chartFilter.innerHTML = '<option value="all">Tous les comptes</option>';
  logFilter.innerHTML = '<option value="all">Tous les comptes</option>';
  conversionFormAccount.innerHTML = "";
  conversionFilter.innerHTML = '<option value="all">Tous les comptes</option>';

  // these selectors always list every account, regardless of the sidebar/Pouls category filter
  accounts.forEach((acc) => {
    [entrySelect, chartFilter, logFilter, conversionFormAccount, conversionFilter].forEach((select) => {
      const opt = document.createElement("option");
      opt.value = acc.id;
      opt.textContent = acc.name;
      select.appendChild(opt);
    });
  });

  if ([...entrySelect.options].some((o) => o.value === prevEntry)) entrySelect.value = prevEntry;
  if ([...chartFilter.options].some((o) => o.value === prevChart)) chartFilter.value = prevChart;
  if ([...logFilter.options].some((o) => o.value === prevLog)) logFilter.value = prevLog;
  if ([...conversionFormAccount.options].some((o) => o.value === prevConversionForm)) conversionFormAccount.value = prevConversionForm;
  if ([...conversionFilter.options].some((o) => o.value === prevConversionFilter)) conversionFilter.value = prevConversionFilter;
}

function populateTagSelects() {
  TAG_AXES.forEach((axis) => {
    const select = document.getElementById(`entry-tag-${axis}`);
    if (!select) return;
    const prev = select.value;
    select.innerHTML = "";
    tagOptionsFor(axis).forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      select.appendChild(opt);
    });
    if ([...select.options].some((o) => o.value === prev)) select.value = prev;
  });
}

function populateNicheFilter() {
  const select = document.getElementById("insights-niche-filter");
  const datalist = document.getElementById("niche-suggestions");
  const prev = select.value;
  select.innerHTML = '<option value="all">Toutes les niches</option>';
  datalist.innerHTML = "";
  nicheOptions().forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n;
    select.appendChild(opt);

    const dOpt = document.createElement("option");
    dOpt.value = n;
    datalist.appendChild(dOpt);
  });
  if ([...select.options].some((o) => o.value === prev)) select.value = prev;
  else insightsNicheFilter = select.value;
}

function wireTagAddButtons() {
  document.querySelectorAll(".tag-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const axis = btn.dataset.axis;
      const axisLabel = TAG_AXIS_LABELS[axis] || axis;
      const value = window.prompt(`Nouveau tag pour "${axisLabel}" :`);
      if (value === null) return;
      if (addCustomTag(axis, value)) {
        populateTagSelects();
        const select = document.getElementById(`entry-tag-${axis}`);
        select.value = value.trim();
      }
    });
  });
}

// --- console readout ---------------------------------------------------

function updateConsoleReadout() {
  const el = document.getElementById("console-readout");
  if (accounts.length === 0) {
    el.textContent = "AUCUN CANAL — ajoute un compte pour démarrer le suivi";
    return;
  }
  const chanLabel = accounts.length > 1 ? "CANAUX ACTIFS" : "CANAL ACTIF";
  const entryLabelText = entries.length > 1 ? "ENTRÉES" : "ENTRÉE";
  let lastLabel = "AUCUN SIGNAL";
  if (entries.length > 0) {
    const lastDate = entries.map((e) => e.date).sort().slice(-1)[0];
    lastLabel = "DERNIER SIGNAL " + lastDate;
  }
  el.textContent = `${accounts.length} ${chanLabel} · ${entries.length} ${entryLabelText} · ${lastLabel}`;
}

// --- signal strip (per-account pulse trace) ---

function buildPulseTrace(accEntries, color) {
  const W = 600;
  const H = 100;
  const padX = 24;
  const topPad = 16;
  const baseY = 88;

  if (accEntries.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="pulse-svg">
      <line x1="0" y1="${baseY}" x2="${W}" y2="${baseY}" class="pulse-flatline" />
    </svg>`;
  }

  const maxViews = Math.max(...accEntries.map((e) => Number(e.views || 0)), 1);
  const n = accEntries.length;
  const step = n > 1 ? (W - padX * 2) / (n - 1) : 0;

  const points = accEntries.map((e, i) => {
    const x = n > 1 ? padX + i * step : W / 2;
    const v = Number(e.views || 0);
    const y = baseY - (v / maxViews) * (baseY - topPad);
    return { x, y, v, e };
  });

  let peakIdx = 0;
  points.forEach((p, i) => {
    if (p.v > points[peakIdx].v) peakIdx = i;
  });
  const peak = points[peakIdx];

  const pathPts = [`0,${baseY}`, ...points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`), `${W},${points[n - 1].y.toFixed(1)}`];
  const d = "M " + pathPts.join(" L ");

  const dots = points
    .map((p) => {
      const isPeak = p === peak;
      const tip = `${escapeHtml(entryLabel(p.e))} — ${Number(p.v).toLocaleString("fr-FR")} vues (${escapeHtml(p.e.date)})`;
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isPeak ? 4.5 : 2.4}" class="pulse-dot${isPeak ? " pulse-dot-peak" : ""}"><title>${tip}</title></circle>`;
    })
    .join("");

  const peakLabel = `<text x="${peak.x.toFixed(1)}" y="${Math.max(peak.y - 9, 10).toFixed(1)}" text-anchor="middle" class="pulse-peak-label">${formatCompact(peak.v)}</text>`;

  const liveDot = `<circle cx="${W}" cy="${points[n - 1].y.toFixed(1)}" r="3.4" class="pulse-live-dot" />`;

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="pulse-svg" style="--chan-color:${color}">
    <path d="${d}" class="pulse-line" />
    ${dots}
    ${peakLabel}
    ${liveDot}
  </svg>`;
}

function renderSignalStrip() {
  const wrap = document.getElementById("signal-strip");
  wrap.innerHTML = "";

  if (accounts.length === 0) {
    wrap.innerHTML = '<p class="signal-empty">Ajoute un compte pour voir son activité ici.</p>';
    return;
  }

  const visible = accountsInCategory(categoryFilter);
  if (visible.length === 0) {
    wrap.innerHTML = '<p class="signal-empty">Aucun compte dans cette catégorie.</p>';
    return;
  }

  visible.forEach((acc) => {
    const color = channelColor(acc.id);
    const accEntries = entries.filter((e) => e.accountId === acc.id).sort((a, b) => new Date(a.date) - new Date(b.date));

    const row = document.createElement("div");
    row.className = "signal-row";

    const head = document.createElement("div");
    head.className = "signal-row-head";
    const dot = document.createElement("span");
    dot.className = "signal-row-dot";
    dot.style.background = color;
    const name = document.createElement("span");
    name.className = "signal-row-name";
    name.textContent = acc.name;
    const badge = document.createElement("span");
    badge.className = `cat-badge cat-${acc.category}`;
    badge.textContent = CATEGORY_LABELS[acc.category];
    const headParts = [dot, name, badge];
    if (acc.niche) {
      const niche = document.createElement("span");
      niche.className = "chip-niche";
      niche.textContent = acc.niche;
      headParts.push(niche);
    }
    const stat = document.createElement("span");
    stat.className = "signal-row-stat";
    if (accEntries.length > 0) {
      const total = accEntries.reduce((sum, e) => sum + Number(e.views || 0), 0);
      const avg = Math.round(total / accEntries.length);
      stat.textContent = `${accEntries.length} reels · moy. ${avg.toLocaleString("fr-FR")} vues`;
    } else {
      stat.textContent = "aucune entrée";
    }
    headParts.push(stat);
    head.append(...headParts);
    row.appendChild(head);

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "signal-row-canvas";
    canvasWrap.innerHTML = buildPulseTrace(accEntries, color);
    if (accEntries.length === 0) {
      const empty = document.createElement("span");
      empty.className = "signal-row-empty-label";
      empty.textContent = "Pas encore de signal pour ce compte.";
      canvasWrap.appendChild(empty);
    }
    row.appendChild(canvasWrap);

    wrap.appendChild(row);
  });
}

// --- charts ------------------------------------------------------------

function renderVariantChart() {
  const filter = document.getElementById("chart-account-filter").value;
  const canvas = document.getElementById("variant-chart");

  let filtered = filter === "all" ? entries.slice() : entries.filter((e) => e.accountId === filter);
  filtered = filtered.sort((a, b) => Number(b.views || 0) - Number(a.views || 0)).slice(0, 8);

  const labels = filtered.map((e) => (filter === "all" ? `${entryLabel(e)} (${accountName(e.accountId)})` : entryLabel(e)));
  const data = filtered.map((e) => Number(e.views || 0));
  const colors = filtered.map((e) => channelColor(e.accountId));

  if (variantChart) variantChart.destroy();
  variantChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Vues",
          data,
          backgroundColor: colors,
          borderRadius: 4,
          maxBarThickness: 22,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#a99a85" }, grid: { color: "#2a2119" } },
        y: { ticks: { color: "#f2ebdd", font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function renderTrendChart() {
  const filter = document.getElementById("chart-account-filter").value;
  const canvas = document.getElementById("trend-chart");

  const relevantEntries = filter === "all" ? entries : entries.filter((e) => e.accountId === filter);
  const uniqueDates = [...new Set(relevantEntries.map((e) => e.date))].sort();

  let datasets = [];
  if (filter === "all") {
    datasets = accounts.map((acc) => {
      const byDate = {};
      entries
        .filter((e) => e.accountId === acc.id)
        .forEach((e) => {
          byDate[e.date] = Number(e.views || 0);
        });
      const color = channelColor(acc.id);
      return {
        label: acc.name,
        data: uniqueDates.map((d) => (byDate[d] !== undefined ? byDate[d] : null)),
        borderColor: color,
        backgroundColor: color,
        tension: 0.3,
        pointRadius: 3,
        spanGaps: true,
      };
    });
  } else {
    const byDate = {};
    entries
      .filter((e) => e.accountId === filter)
      .forEach((e) => {
        byDate[e.date] = Number(e.views || 0);
      });
    const color = channelColor(filter);
    datasets = [
      {
        label: accountName(filter),
        data: uniqueDates.map((d) => byDate[d]),
        borderColor: color,
        backgroundColor: color,
        tension: 0.3,
        pointRadius: 3,
      },
    ];
  }

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(canvas, {
    type: "line",
    data: { labels: uniqueDates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: filter === "all",
          labels: { color: "#f2ebdd", boxWidth: 10, font: { size: 11 } },
        },
      },
      scales: {
        x: { ticks: { color: "#a99a85" }, grid: { color: "#2a2119" } },
        y: { ticks: { color: "#a99a85" }, grid: { color: "#2a2119" } },
      },
    },
  });
}

// --- log table ----------------------------------------------------------

function renderLogTable() {
  const filter = document.getElementById("log-account-filter").value;
  const body = document.getElementById("log-body");
  const emptyMsg = document.getElementById("log-empty");
  body.innerHTML = "";

  let filtered = filter === "all" ? entries.slice() : entries.filter((e) => e.accountId === filter);
  filtered = filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (filtered.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  const maxByAccount = {};
  entries.forEach((e) => {
    const v = Number(e.views || 0);
    if (!maxByAccount[e.accountId] || v > maxByAccount[e.accountId]) maxByAccount[e.accountId] = v;
  });

  filtered.forEach((e) => {
    const tr = document.createElement("tr");
    const isPeak = Number(e.views || 0) === maxByAccount[e.accountId] && Number(e.views || 0) > 0;
    tr.innerHTML = `
      <td>${escapeHtml(e.date)}</td>
      <td>${escapeHtml(accountName(e.accountId))}</td>
      <td>${escapeHtml(entryLabel(e))}${tagChipsHtml(e.tags)}</td>
      <td class="${isPeak ? "peak-views" : ""}">${Number(e.views || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.likes || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.comments || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.shares || 0).toLocaleString("fr-FR")}</td>
      <td class="notes-cell">${escapeHtml(e.notes || "")}</td>
    `;
    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "row-delete";
    delBtn.textContent = "✕";
    delBtn.title = "Supprimer cette entrée";
    delBtn.addEventListener("click", () => {
      entries = entries.filter((x) => x.id !== e.id);
      saveEntries(entries);
      renderAll();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    body.appendChild(tr);
  });
}

// --- insights (structured tags -> what works) ---------------------------

function filterEntriesForInsights() {
  const accIds = new Set(
    accounts
      .filter((a) => insightsCategoryFilter === "all" || a.category === insightsCategoryFilter)
      .filter((a) => insightsNicheFilter === "all" || a.niche === insightsNicheFilter)
      .map((a) => a.id)
  );
  return entries.filter((e) => accIds.has(e.accountId));
}

function computeAxisBreakdown(axis, filteredEntries) {
  const groups = {};
  filteredEntries.forEach((e) => {
    const val = (e.tags && e.tags[axis]) || TAG_UNCLASSIFIED;
    if (!groups[val]) groups[val] = { tag: val, count: 0, totalViews: 0, totalEngagement: 0 };
    groups[val].count += 1;
    groups[val].totalViews += Number(e.views || 0);
    groups[val].totalEngagement += engagementRate(e);
  });
  const rows = Object.values(groups).map((g) => ({
    tag: g.tag,
    count: g.count,
    avgViews: g.totalViews / g.count,
    avgEngagement: g.totalEngagement / g.count,
  }));
  rows.sort((a, b) => (insightsMetric === "engagement" ? b.avgEngagement - a.avgEngagement : b.avgViews - a.avgViews));
  return rows;
}

function renderInsightsAxisChart(axis, filteredEntries) {
  const canvas = document.getElementById(`insights-chart-${axis}`);
  const rows = computeAxisBreakdown(axis, filteredEntries).slice(0, 8);
  if (insightsCharts[axis]) insightsCharts[axis].destroy();

  const color = CHANNEL_COLORS[TAG_AXES.indexOf(axis) % CHANNEL_COLORS.length];
  const labels = rows.map((r) => r.tag);
  const data = rows.map((r) => (insightsMetric === "engagement" ? r.avgEngagement * 100 : r.avgViews));

  insightsCharts[axis] = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4, maxBarThickness: 18 }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const row = rows[ctx.dataIndex];
              const val = insightsMetric === "engagement" ? formatPercent(row.avgEngagement) : formatCompact(row.avgViews) + " vues";
              return `${val} moy. (${row.count} vidéo${row.count > 1 ? "s" : ""})`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#a99a85" }, grid: { color: "#2a2119" } },
        y: { ticks: { color: "#f2ebdd", font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function renderInsightsLeaderboard(filteredEntries) {
  const body = document.getElementById("insights-leaderboard-body");
  const emptyMsg = document.getElementById("insights-leaderboard-empty");
  body.innerHTML = "";

  const sorted = filteredEntries
    .slice()
    .sort((a, b) => (insightsSort === "engagement" ? engagementRate(b) - engagementRate(a) : Number(b.views || 0) - Number(a.views || 0)))
    .slice(0, 20);

  if (sorted.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  sorted.forEach((e, i) => {
    const acc = accounts.find((a) => a.id === e.accountId);
    const tr = document.createElement("tr");
    const rankClass = i === 0 ? "rank-badge rank-1" : i === 1 ? "rank-badge rank-2" : i === 2 ? "rank-badge rank-3" : "";
    tr.innerHTML = `
      <td class="${rankClass}">${i + 1}</td>
      <td>${escapeHtml(acc ? acc.name : "?")}</td>
      <td>${escapeHtml((acc && acc.niche) || "—")}</td>
      <td>${escapeHtml(e.date)}</td>
      <td>${escapeHtml(entryLabel(e))}${tagChipsHtml(e.tags)}</td>
      <td>${Number(e.views || 0).toLocaleString("fr-FR")}</td>
      <td>${formatPercent(engagementRate(e))}</td>
    `;
    body.appendChild(tr);
  });
}

function renderInsights() {
  populateNicheFilter();
  const filtered = filterEntriesForInsights();
  const emptyMsg = document.getElementById("insights-empty");
  const grid = document.getElementById("insights-grid");

  if (filtered.length === 0) {
    emptyMsg.style.display = "block";
    grid.style.display = "none";
    TAG_AXES.forEach((axis) => {
      if (insightsCharts[axis]) {
        insightsCharts[axis].destroy();
        insightsCharts[axis] = null;
      }
    });
  } else {
    emptyMsg.style.display = "none";
    grid.style.display = "grid";
    TAG_AXES.forEach((axis) => renderInsightsAxisChart(axis, filtered));
  }

  renderInsightsLeaderboard(filtered);
}

// --- conversion (daily clicks / new subs vs content activity) ----------

function computeDailyContentViews(scope) {
  const relevant = scope === "all" ? entries : entries.filter((e) => e.accountId === scope);
  const byDate = {};
  relevant.forEach((e) => {
    byDate[e.date] = (byDate[e.date] || 0) + Number(e.views || 0);
  });
  return byDate;
}

function computeDailyConversions(scope) {
  const relevant = scope === "all" ? conversions : conversions.filter((c) => c.accountId === scope);
  const byDate = {};
  relevant.forEach((c) => {
    if (!byDate[c.date]) byDate[c.date] = { linkClicks: 0, newSubs: 0, revenue: 0 };
    byDate[c.date].linkClicks += Number(c.linkClicks || 0);
    byDate[c.date].newSubs += Number(c.newSubs || 0);
    byDate[c.date].revenue += Number(c.revenue || 0);
  });
  return byDate;
}

function renderConversionChart() {
  const filter = document.getElementById("conversion-account-filter").value;
  const canvas = document.getElementById("conversion-chart");
  const emptyMsg = document.getElementById("conversion-chart-empty");

  const viewsByDate = computeDailyContentViews(filter);
  const convByDate = computeDailyConversions(filter);
  const allDates = [...new Set([...Object.keys(viewsByDate), ...Object.keys(convByDate)])].sort();

  if (allDates.length === 0) {
    emptyMsg.style.display = "block";
    canvas.style.display = "none";
    if (conversionChart) {
      conversionChart.destroy();
      conversionChart = null;
    }
    return;
  }
  emptyMsg.style.display = "none";
  canvas.style.display = "block";

  if (conversionChart) conversionChart.destroy();
  conversionChart = new Chart(canvas, {
    data: {
      labels: allDates,
      datasets: [
        {
          type: "line",
          label: "Vues (contenu)",
          data: allDates.map((d) => (viewsByDate[d] !== undefined ? viewsByDate[d] : null)),
          borderColor: "#e8a94a",
          backgroundColor: "#e8a94a",
          yAxisID: "y",
          tension: 0.3,
          spanGaps: true,
          pointRadius: 3,
        },
        {
          type: "bar",
          label: "Nouveaux abonnés",
          data: allDates.map((d) => (convByDate[d] ? convByDate[d].newSubs : 0)),
          backgroundColor: "#7fbd8a",
          yAxisID: "y1",
        },
        {
          type: "bar",
          label: "Clics lien bio",
          data: allDates.map((d) => (convByDate[d] ? convByDate[d].linkClicks : 0)),
          backgroundColor: "#7c93e0",
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#f2ebdd", boxWidth: 10, font: { size: 11 } } },
      },
      scales: {
        x: { ticks: { color: "#a99a85" }, grid: { color: "#2a2119" } },
        y: {
          position: "left",
          ticks: { color: "#a99a85" },
          grid: { color: "#2a2119" },
          title: { display: true, text: "Vues", color: "#a99a85" },
        },
        y1: { position: "right", ticks: { color: "#a99a85" }, grid: { display: false } },
      },
    },
  });
}

function renderConversionLogTable() {
  const filter = document.getElementById("conversion-account-filter").value;
  const body = document.getElementById("conversion-log-body");
  const emptyMsg = document.getElementById("conversion-log-empty");
  body.innerHTML = "";

  let filtered = filter === "all" ? conversions.slice() : conversions.filter((c) => c.accountId === filter);
  filtered = filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (filtered.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  filtered.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.date)}</td>
      <td>${escapeHtml(accountName(c.accountId))}</td>
      <td>${Number(c.linkClicks || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(c.newSubs || 0).toLocaleString("fr-FR")}</td>
      <td>${c.revenue ? Number(c.revenue).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "—"}</td>
    `;
    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "row-delete";
    delBtn.textContent = "✕";
    delBtn.title = "Supprimer cette entrée";
    delBtn.addEventListener("click", () => {
      conversions = conversions.filter((x) => x.id !== c.id);
      saveConversions(conversions);
      renderAll();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    body.appendChild(tr);
  });
}

// --- boot / render all ---------------------------------------------------

function renderAll() {
  populateTagSelects();
  renderAccountChips();
  populateAccountSelects();
  updateConsoleReadout();
  renderSignalStrip();
  renderVariantChart();
  renderTrendChart();
  renderLogTable();
  renderInsights();
  renderConversionChart();
  renderConversionLogTable();
}

setupSegmented("category-filter", (value) => {
  categoryFilter = value;
  renderAccountChips();
  renderSignalStrip();
});

setupSegmented("new-account-category", (value) => {
  newAccountCategory = value;
});

setupSegmented("insights-category-filter", (value) => {
  insightsCategoryFilter = value;
  renderInsights();
});

setupSegmented("insights-metric-toggle", (value) => {
  insightsMetric = value;
  renderInsights();
});

document.getElementById("insights-niche-filter").addEventListener("change", (e) => {
  insightsNicheFilter = e.target.value;
  renderInsights();
});

document.getElementById("insights-leaderboard-sort").addEventListener("change", (e) => {
  insightsSort = e.target.value;
  renderInsights();
});

document.getElementById("conversion-account-filter").addEventListener("change", () => {
  renderConversionChart();
  renderConversionLogTable();
});

document.getElementById("add-account-btn").addEventListener("click", () => {
  const input = document.getElementById("new-account-input");
  const nicheInput = document.getElementById("new-account-niche");
  const name = input.value.trim();
  if (!name) return;
  accounts.push({ id: uid(), name, category: newAccountCategory, niche: nicheInput.value.trim() });
  saveAccounts(accounts);
  input.value = "";
  nicheInput.value = "";
  renderAll();
});
document.getElementById("new-account-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("add-account-btn").click();
  }
});

document.getElementById("entry-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const accountId = document.getElementById("entry-account").value;
  if (!accountId) {
    alert("Ajoute d'abord un compte.");
    return;
  }
  const tags = {};
  TAG_AXES.forEach((axis) => {
    const select = document.getElementById(`entry-tag-${axis}`);
    tags[axis] = select ? select.value : TAG_UNCLASSIFIED;
  });
  entries.push({
    id: uid(),
    accountId,
    date: document.getElementById("entry-date").value,
    label: document.getElementById("entry-label").value.trim(),
    tags,
    views: document.getElementById("entry-views").value,
    likes: document.getElementById("entry-likes").value,
    comments: document.getElementById("entry-comments").value,
    shares: document.getElementById("entry-shares").value,
    notes: document.getElementById("entry-notes").value.trim(),
  });
  saveEntries(entries);
  e.target.reset();
  document.getElementById("entry-date").value = new Date().toISOString().slice(0, 10);
  renderAll();
});

document.getElementById("conversion-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const accountId = document.getElementById("conversion-form-account").value;
  if (!accountId) {
    alert("Ajoute d'abord un compte.");
    return;
  }
  upsertConversion(
    accountId,
    document.getElementById("conversion-form-date").value,
    document.getElementById("conversion-form-clicks").value,
    document.getElementById("conversion-form-subs").value,
    document.getElementById("conversion-form-revenue").value
  );
  e.target.reset();
  document.getElementById("conversion-form-date").value = new Date().toISOString().slice(0, 10);
  renderAll();
});

document.getElementById("chart-account-filter").addEventListener("change", () => {
  renderVariantChart();
  renderTrendChart();
});
document.getElementById("log-account-filter").addEventListener("change", renderLogTable);

wireTagAddButtons();

document.getElementById("entry-date").value = new Date().toISOString().slice(0, 10);
document.getElementById("conversion-form-date").value = new Date().toISOString().slice(0, 10);
renderAll();
