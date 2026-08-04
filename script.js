const STORAGE_ACCOUNTS = "signal_accounts";
const STORAGE_ENTRIES = "signal_entries";
const STORAGE_CONVERSIONS = "signal_conversions";
const STORAGE_TAG_VOCAB = "signal_tag_vocab";
const STORAGE_MODELS = "signal_models";
const STORAGE_PENDING_SYNC = "signal_pending_sync";

// one color per channel — reused consistently across account cards, pulse traces and charts.
// fixed CVD-safe order (never cycled/reassigned) — see dataviz skill's validated palette.
const CHANNEL_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

// Chart.js chrome shared across every chart (light surface tokens)
const CHART_INK = "#6b7280";
const CHART_GRID = "#e5e7eb";
const CHART_LEGEND = "#111827";

// structured content taxonomy — predefined lists stay hardcoded so future default
// changes aren't shadowed by stale localStorage; users can extend via signal_tag_vocab
const TAG_AXES = ["hook", "format", "longueur", "cta", "son"];
const TAG_UNCLASSIFIED = "Non classé";
const TAG_AXIS_LABELS = { hook: "Hook", format: "Format", longueur: "Longueur", cta: "CTA", son: "Son" };

const ACCOUNT_STATUS_LABELS = { actif: "Actif", pause: "En pause", shadowban: "Shadowban", banni: "Banni" };
const ACCOUNT_STATUSES = ["actif", "pause", "shadowban", "banni"];
const PREDEFINED_TAGS = {
  hook: ["Question", "Pattern interrupt", "Storytime", "POV", "Avant/Après", "Statistique choc", "Controverse", "Autre"],
  format: ["Talking head", "Voix off", "Greenscreen", "Transition", "Texte à l'écran", "Duo/Stitch", "Autre"],
  longueur: ["<15s", "15-30s", "30-60s", "60s+"],
  cta: ["Lien en bio", "Commente pour", "Abonne-toi", "DM-moi", "Aucun"],
  son: ["Audio tendance", "Musique originale", "Voix seule", "Silence"],
};

// --- supabase client -------------------------------------------------------

const SUPABASE_URL = "https://uzcwvdmjqiborxqaiwng.supabase.co";
const SUPABASE_KEY = "sb_publishable_14rnqrufRLxwD6BlldQHvQ_PdErSlTX";
// named supabaseClient (not `supabase`) so it doesn't shadow the CDN's global namespace
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- storage (localStorage = offline cache, Supabase = source of truth) ----

function normalizeAccount(a) {
  // defaults for every field so pre-existing/partial data keeps working without loss.
  // (category is a leftover field on older records; no longer read anywhere)
  return {
    ...a,
    niche: typeof a.niche === "string" ? a.niche : "",
    createdDate: typeof a.createdDate === "string" ? a.createdDate : "",
    creationMethod: typeof a.creationMethod === "string" ? a.creationMethod : "",
    status: ACCOUNT_STATUSES.includes(a.status) ? a.status : "actif",
    warmup: typeof a.warmup === "string" ? a.warmup : "",
    accountNotes: typeof a.accountNotes === "string" ? a.accountNotes : "",
  };
}

function loadAccountsLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_ACCOUNTS)) || [];
    return raw.map(normalizeAccount);
  } catch {
    return [];
  }
}
function saveAccountsLocal(accounts) {
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
    soundName: typeof e.soundName === "string" ? e.soundName : "",
    views: e.views,
    likes: e.likes,
    comments: e.comments,
    shares: e.shares,
    notes: e.notes,
    // stable per-account reel number, assigned once at creation and never reassigned —
    // null here means "not backfilled yet", handled by backfillEntrySeq() at load time
    seq: e.seq != null ? Number(e.seq) : null,
    // set only when this entry was created via the "Dupliquer" flow from another reel —
    // denormalized (name/label/seq snapshot) so the origin still reads fine if the source is later deleted
    duplicatedFromEntryId: e.duplicatedFromEntryId || null,
    duplicatedFromAccountName: typeof e.duplicatedFromAccountName === "string" ? e.duplicatedFromAccountName : "",
    duplicatedFromLabel: typeof e.duplicatedFromLabel === "string" ? e.duplicatedFromLabel : "",
    duplicatedFromSeq: e.duplicatedFromSeq != null ? Number(e.duplicatedFromSeq) : null,
  };
}

// assigns a stable, permanent per-account reel number to any entry that doesn't have one yet
// (data saved before this feature existed) — computed once in creation-date order, then the
// caller persists it so numbers never shift again after this pass. Returns the entries touched.
function backfillEntrySeq(list) {
  const maxByAccount = {};
  list.forEach((e) => {
    if (e.seq != null) maxByAccount[e.accountId] = Math.max(maxByAccount[e.accountId] || 0, e.seq);
  });
  const missing = list
    .filter((e) => e.seq == null)
    .sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.id).localeCompare(String(b.id)));
  missing.forEach((e) => {
    const next = (maxByAccount[e.accountId] || 0) + 1;
    e.seq = next;
    maxByAccount[e.accountId] = next;
  });
  return missing;
}
function loadEntriesLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_ENTRIES)) || [];
    const list = raw.map(migrateEntry);
    if (backfillEntrySeq(list).length) saveEntriesLocal(list);
    return list;
  } catch {
    return [];
  }
}
function saveEntriesLocal(entries) {
  localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(entries));
}

function loadConversionsLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CONVERSIONS)) || [];
  } catch {
    return [];
  }
}
function saveConversionsLocal(conversions) {
  localStorage.setItem(STORAGE_CONVERSIONS, JSON.stringify(conversions));
}

function loadTagVocabLocal() {
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
function saveTagVocabLocal(vocab) {
  localStorage.setItem(STORAGE_TAG_VOCAB, JSON.stringify(vocab));
}

function loadModelsLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_MODELS)) || [];
    return raw.map((m) => (typeof m === "string" ? m.trim() : "")).filter(Boolean);
  } catch {
    return [];
  }
}
function saveModelsLocal(models) {
  localStorage.setItem(STORAGE_MODELS, JSON.stringify(models));
}

function loadPendingSyncLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_PENDING_SYNC)) || [];
  } catch {
    return [];
  }
}
function savePendingSyncLocal(queue) {
  localStorage.setItem(STORAGE_PENDING_SYNC, JSON.stringify(queue));
}

let accounts = loadAccountsLocal();
let entries = loadEntriesLocal();
let conversions = loadConversionsLocal();
let tagVocab = loadTagVocabLocal();
let models = loadModelsLocal();
let pendingSync = loadPendingSyncLocal();

// --- db row <-> app-shape mappers -------------------------------------------

function mapAccountToDb(a) {
  return {
    id: a.id,
    name: a.name,
    niche: a.niche || "",
    status: a.status || "actif",
    created_date: a.createdDate || "",
    creation_method: a.creationMethod || "",
    warmup: a.warmup || "",
    account_notes: a.accountNotes || "",
  };
}
function mapAccountFromDb(row) {
  return normalizeAccount({
    id: row.id,
    name: row.name,
    niche: row.niche,
    status: row.status,
    createdDate: row.created_date,
    creationMethod: row.creation_method,
    warmup: row.warmup,
    accountNotes: row.account_notes,
  });
}

function mapEntryToDb(e) {
  return {
    id: e.id,
    account_id: e.accountId,
    date: e.date,
    label: e.label || "",
    tags: e.tags || {},
    sound_name: e.soundName || "",
    views: e.views,
    likes: e.likes,
    comments: e.comments,
    shares: e.shares,
    notes: e.notes || "",
    seq: e.seq != null ? e.seq : null,
    duplicated_from_entry_id: e.duplicatedFromEntryId || null,
    duplicated_from_account_name: e.duplicatedFromAccountName || "",
    duplicated_from_label: e.duplicatedFromLabel || "",
    duplicated_from_seq: e.duplicatedFromSeq != null ? e.duplicatedFromSeq : null,
  };
}
function mapEntryFromDb(row) {
  return migrateEntry({
    id: row.id,
    accountId: row.account_id,
    date: row.date,
    label: row.label,
    tags: row.tags,
    soundName: row.sound_name,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    notes: row.notes,
    seq: row.seq,
    duplicatedFromEntryId: row.duplicated_from_entry_id,
    duplicatedFromAccountName: row.duplicated_from_account_name,
    duplicatedFromLabel: row.duplicated_from_label,
    duplicatedFromSeq: row.duplicated_from_seq,
  });
}

function mapConversionToDb(c) {
  return {
    id: c.id,
    account_id: c.accountId,
    date: c.date,
    link_clicks: c.linkClicks,
    new_subs: c.newSubs,
  };
}
function mapConversionFromDb(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    date: row.date,
    linkClicks: row.link_clicks,
    newSubs: row.new_subs,
  };
}

function mapTagVocabFromDb(rows) {
  const vocab = {};
  TAG_AXES.forEach((axis) => {
    const row = rows.find((r) => r.axis === axis);
    vocab[axis] = row && Array.isArray(row.values) ? row.values : [];
  });
  return vocab;
}

let trendChart = null;
let insightsCharts = {}; // { hook: Chart, format: Chart, ... }
let compareCharts = {}; // same shape, for the cross-model Comparer section
let conversionViewsChart = null;
let conversionMetricsChart = null;

// navigation state — Modèles (level 0) -> Modèle (level 1) -> Compte (level 2)
let currentView = "models"; // "models" | "model" | "account"
let currentNiche = null;
let currentAccountId = null;

// Insights tab state
let insightsMetric = "views"; // "views" | "engagement"
let insightsSort = "views"; // "views" | "engagement"

// Comparer section state (on the Modèles page)
let compareMetric = "views"; // "views" | "engagement"

// active tab within the account view
let activeTab = "dashboard";

// id of the entry currently being edited via the sidebar form, or null when adding a new one
let editingEntryId = null;

// whether the "Infos du compte" card is in edit mode
let editingAccountInfo = false;

// id of the leaderboard entry currently showing its target-account picker, or null
let duplicatingEntryId = null;

// { entryId, label, tags, soundName, accountName } of the source reel being duplicated
// into the sidebar's "new entry" form, or null once submitted/cancelled
let pendingDuplicate = null;

// --- sync queue (persisted — a failed cloud write is retried, never silently dropped) ---

function queueSync(table, op, payload) {
  // op: "upsert" | "delete"
  pendingSync.push({ table, op, payload, ts: Date.now() });
  savePendingSyncLocal(pendingSync);
  updateSyncBanner();
  flushPendingSync();
}

async function flushPendingSync() {
  if (pendingSync.length === 0) return;
  const remaining = [];
  for (const item of pendingSync) {
    try {
      const { error } =
        item.op === "upsert"
          ? await supabaseClient.from(item.table).upsert(item.payload)
          : await supabaseClient.from(item.table).delete().eq("id", item.payload.id);
      if (error) throw error;
    } catch {
      remaining.push(item);
    }
  }
  pendingSync = remaining;
  savePendingSyncLocal(pendingSync);
  updateSyncBanner();
}

function updateSyncBanner() {
  const banner = document.getElementById("sync-banner");
  if (!banner) return;
  if (pendingSync.length === 0) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.textContent = `⚠️ ${pendingSync.length} changement${pendingSync.length > 1 ? "s" : ""} en attente de synchronisation avec le cloud.`;
}

window.addEventListener("online", flushPendingSync);

// --- boot: auth gate -> cloud fetch (local fallback) -> first render -------

function showView(name) {
  document.getElementById("view-login").hidden = name !== "login";
  document.getElementById("view-loading").hidden = name !== "loading";
  document.getElementById("app-root").hidden = name !== "app";
}

async function loadAllData() {
  try {
    const [a, e, c, m, t] = await Promise.all([
      supabaseClient.from("accounts").select("*"),
      supabaseClient.from("entries").select("*"),
      supabaseClient.from("conversions").select("*"),
      supabaseClient.from("models").select("*"),
      supabaseClient.from("tag_vocab").select("*"),
    ]);
    const firstError = a.error || e.error || c.error || m.error || t.error;
    if (firstError) throw firstError;

    const cloudWasEmpty = a.data.length === 0;
    const localAccounts = loadAccountsLocal();

    accounts = a.data.map(mapAccountFromDb);
    entries = e.data.map(mapEntryFromDb);
    conversions = c.data.map(mapConversionFromDb);
    models = m.data.map((row) => row.name);
    tagVocab = mapTagVocabFromDb(t.data);

    if (cloudWasEmpty && localAccounts.length > 0) {
      // filet de sécurité : un utilisateur qui avait déjà des données locales (avant Supabase)
      // ne doit pas les voir disparaître silencieusement — on les pousse une fois vers le cloud.
      await migrateLocalDataToCloud();
    }

    const backfilledEntries = backfillEntrySeq(entries);

    saveAccountsLocal(accounts);
    saveEntriesLocal(entries);
    saveConversionsLocal(conversions);
    saveModelsLocal(models);
    saveTagVocabLocal(tagVocab);

    backfilledEntries.forEach((en) => queueSync("entries", "upsert", mapEntryToDb(en)));
  } catch (err) {
    console.warn("Supabase indisponible, repli sur le cache local", err);
    accounts = loadAccountsLocal();
    entries = loadEntriesLocal();
    conversions = loadConversionsLocal();
    models = loadModelsLocal();
    tagVocab = loadTagVocabLocal();
  }
  updateSyncBanner();
  flushPendingSync();
}

async function migrateLocalDataToCloud() {
  const localAccounts = loadAccountsLocal();
  const localEntries = loadEntriesLocal();
  const localConversions = loadConversionsLocal();
  const localModels = loadModelsLocal();
  const localTagVocab = loadTagVocabLocal();

  accounts = localAccounts;
  entries = localEntries;
  conversions = localConversions;
  models = localModels;
  tagVocab = localTagVocab;

  if (localAccounts.length) await supabaseClient.from("accounts").upsert(localAccounts.map(mapAccountToDb));
  if (localEntries.length) await supabaseClient.from("entries").upsert(localEntries.map(mapEntryToDb));
  if (localConversions.length) await supabaseClient.from("conversions").upsert(localConversions.map(mapConversionToDb));
  if (localModels.length) await supabaseClient.from("models").upsert(localModels.map((name) => ({ name })));
  const tagRows = TAG_AXES.filter((axis) => (localTagVocab[axis] || []).length > 0).map((axis) => ({ axis, values: localTagVocab[axis] }));
  if (tagRows.length) await supabaseClient.from("tag_vocab").upsert(tagRows);
}

async function boot() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  if (!session) {
    showView("login");
    return;
  }
  showView("loading");
  await loadAllData();
  showView("app");
  renderCurrentView();
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (!session) showView("login");
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.hidden = true;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    errorEl.textContent = "Email ou mot de passe incorrect.";
    errorEl.hidden = false;
    return;
  }
  boot();
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  showView("login");
});

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function accountName(id) {
  const acc = accounts.find((a) => a.id === id);
  return acc ? acc.name : "?";
}

// scoped within the account's own model, not the global account list, so a
// small handful of colors stays stable and distinguishable per model
function channelColor(accountId) {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return CHANNEL_COLORS[0];
  const siblings = accountsForNiche(acc.niche);
  const idx = siblings.findIndex((a) => a.id === accountId);
  return CHANNEL_COLORS[(idx < 0 ? 0 : idx) % CHANNEL_COLORS.length];
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

// days elapsed since a reel was posted — used to nudge the user to come back
// and log the settled view/like counts once a post's growth has flattened out
function daysSince(dateStr) {
  const posted = new Date(dateStr);
  if (isNaN(posted)) return 0;
  const diffMs = new Date().setHours(0, 0, 0, 0) - posted.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round(diffMs / 86400000));
}

// days since an account's most recent post — flags accounts that have gone quiet,
// distinct from daysSince() which tracks the age of one specific reel.
function daysSinceLastPost(accountId) {
  const accEntries = entriesForAccount(accountId);
  if (accEntries.length === 0) return null;
  const lastDate = accEntries.map((e) => e.date).sort().slice(-1)[0];
  return daysSince(lastDate);
}

function tagChipsHtml(tags) {
  if (!tags) return "";
  const chips = TAG_AXES.map((axis) => tags[axis]).filter((t) => t && t !== TAG_UNCLASSIFIED);
  if (chips.length === 0) return "";
  return `<div class="tag-chip-row">${chips.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</div>`;
}

function soundNameHtml(soundName) {
  if (!soundName || !soundName.trim()) return "";
  return `<div class="sound-name-tag">🎵 ${escapeHtml(soundName.trim())}</div>`;
}

function entrySeqBadge(entry) {
  return entry.seq != null ? `<span class="entry-seq">#${entry.seq}</span> ` : "";
}

// how many times this reel has been duplicated onto other accounts —
// derived from the entries that reference it, never stored directly, so it can't drift out of sync
function duplicateCountFor(entryId) {
  return entries.filter((e) => e.duplicatedFromEntryId === entryId).length;
}

function duplicateOriginHtml(entry) {
  if (!entry.duplicatedFromEntryId) return "";
  const seqPrefix = entry.duplicatedFromSeq != null ? `#${entry.duplicatedFromSeq} ` : "";
  const label = entry.duplicatedFromLabel ? ` — "${seqPrefix}${escapeHtml(entry.duplicatedFromLabel)}"` : "";
  return `<div class="duplicate-origin">🔁 Dupliqué depuis <strong>${escapeHtml(entry.duplicatedFromAccountName || "un autre compte")}</strong>${label}</div>`;
}

// --- model / account scoping ---------------------------------------------

function allModelNames() {
  const seen = new Map(); // lowercase -> valeur affichée (première rencontrée)
  models.forEach((m) => {
    const k = m.toLowerCase();
    if (!seen.has(k)) seen.set(k, m);
  });
  accounts.forEach((a) => {
    const n = (a.niche || "").trim();
    if (n) {
      const k = n.toLowerCase();
      if (!seen.has(k)) seen.set(k, n);
    }
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

function resolveNicheCasing(niche) {
  const found = allModelNames().find((m) => m.toLowerCase() === niche.trim().toLowerCase());
  return found || niche.trim();
}

function accountsForNiche(niche) {
  if (!niche) return accounts.filter((a) => !a.niche || !a.niche.trim());
  const target = niche.trim().toLowerCase();
  return accounts.filter((a) => (a.niche || "").trim().toLowerCase() === target);
}

function entriesForAccount(accountId) {
  return entries.filter((e) => e.accountId === accountId);
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
  saveTagVocabLocal(tagVocab);
  // one row per axis — never the whole tagVocab object, or a sibling axis edited
  // elsewhere between sessions would get silently clobbered by this upsert.
  queueSync("tag_vocab", "upsert", { axis, values: tagVocab[axis] });
  return true;
}

// --- daily conversion log (per account, per day — upsert) ----------------

function upsertConversion(accountId, date, linkClicks, newSubs) {
  const existing = conversions.find((c) => c.accountId === accountId && c.date === date);
  let row;
  if (existing) {
    existing.linkClicks = linkClicks;
    existing.newSubs = newSubs;
    row = existing;
  } else {
    row = { id: uid(), accountId, date, linkClicks, newSubs };
    conversions.push(row);
  }
  saveConversionsLocal(conversions);
  queueSync("conversions", "upsert", mapConversionToDb(row));
}

// --- segmented controls ---------------------------------------------------

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

// --- scoped stats (models overview / one model / one account) ------------

function computeStatsForEntries(entriesList) {
  const totalViews = entriesList.reduce((s, e) => s + Number(e.views || 0), 0);
  const avgEngagement = entriesList.length ? entriesList.reduce((s, e) => s + engagementRate(e), 0) / entriesList.length : 0;
  let bestEntry = null;
  entriesList.forEach((e) => {
    if (!bestEntry || Number(e.views || 0) > Number(bestEntry.views || 0)) bestEntry = e;
  });
  return { totalViews, avgEngagement, bestEntryLabel: bestEntry ? entryLabel(bestEntry) : "—" };
}

function computeModelStats(niche) {
  const accs = accountsForNiche(niche);
  const accIds = new Set(accs.map((a) => a.id));
  const entriesList = entries.filter((e) => accIds.has(e.accountId));
  const base = computeStatsForEntries(entriesList);

  const accountGroups = {};
  entriesList.forEach((e) => {
    if (!accountGroups[e.accountId]) accountGroups[e.accountId] = { total: 0, count: 0 };
    accountGroups[e.accountId].total += Number(e.views || 0);
    accountGroups[e.accountId].count += 1;
  });
  let bestAccountName = "—";
  let bestAvg = -1;
  Object.entries(accountGroups).forEach(([id, g]) => {
    const avg = g.total / g.count;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestAccountName = accountName(id);
    }
  });

  return { ...base, bestAccountName };
}

function computeAccountStats(accountId) {
  const entriesList = entriesForAccount(accountId);
  const base = computeStatsForEntries(entriesList);
  const totalNewSubs = conversions.filter((c) => c.accountId === accountId).reduce((s, c) => s + Number(c.newSubs || 0), 0);
  return { ...base, totalNewSubs };
}

function setStatSlot(slot, label, value) {
  document.getElementById(`stat-label-${slot}`).textContent = label;
  document.getElementById(`stat-value-${slot}`).textContent = value;
}

// --- navigation ------------------------------------------------------------

function goToModels() {
  currentView = "models";
  currentNiche = null;
  currentAccountId = null;
  editingEntryId = null;
  editingAccountInfo = false;
  pendingDuplicate = null;
  renderCurrentView();
}

function goToModel(niche) {
  currentView = "model";
  currentNiche = niche === "" ? "" : resolveNicheCasing(niche);
  currentAccountId = null;
  editingEntryId = null;
  editingAccountInfo = false;
  pendingDuplicate = null;
  renderCurrentView();
}

function goToAccount(accountId) {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return;
  currentView = "account";
  currentAccountId = accountId;
  currentNiche = acc.niche || "";
  activeTab = "dashboard";
  editingEntryId = null;
  editingAccountInfo = false;
  pendingDuplicate = null;
  renderCurrentView();
}

function renderCurrentView() {
  document.getElementById("view-models").hidden = currentView !== "models";
  document.getElementById("scoped-header").hidden = currentView === "models";
  document.getElementById("view-model").hidden = currentView !== "model";
  document.getElementById("view-account").hidden = currentView !== "account";

  document.getElementById("sidebar-add-account").hidden = currentView !== "model";
  document.getElementById("sidebar-new-entry").hidden = currentView !== "account";
  renderDuplicateBanner();

  if (currentView === "models") renderModelsView();
  else if (currentView === "model") renderModelView();
  else if (currentView === "account") renderAccountView();
}

// --- level 0 : Modèles ------------------------------------------------------

function renderModelsView() {
  const totalAccounts = accounts.length;
  const totalEntries = entries.length;
  document.getElementById("models-summary").textContent =
    totalAccounts > 0
      ? `${totalAccounts} compte${totalAccounts > 1 ? "s" : ""} · ${totalEntries} entrée${totalEntries > 1 ? "s" : ""} au total`
      : "Ajoute ta première modèle pour démarrer le suivi.";

  const grid = document.getElementById("models-grid");
  grid.innerHTML = "";

  const names = allModelNames();
  const hasOrphans = accounts.some((a) => !a.niche || !a.niche.trim());

  if (names.length === 0 && !hasOrphans) {
    grid.innerHTML = '<p class="empty-hint">Aucune modèle pour l\'instant. Clique sur "+ Nouvelle modèle" pour commencer.</p>';
  } else {
    names.forEach((niche) => grid.appendChild(buildModelCard(niche, niche)));
    if (hasOrphans) grid.appendChild(buildModelCard("", "Sans modèle"));
  }

  renderCompareSection();
}

// --- cross-model comparison (which niche/tag wins across everyone) ---------

function renderCompareSection() {
  const allEntries = entries.slice();
  const emptyMsg = document.getElementById("compare-empty");
  const content = document.getElementById("compare-content");

  if (allEntries.length === 0) {
    emptyMsg.style.display = "block";
    content.style.display = "none";
    TAG_AXES.forEach((axis) => {
      if (compareCharts[axis]) {
        compareCharts[axis].destroy();
        compareCharts[axis] = null;
      }
    });
    return;
  }
  emptyMsg.style.display = "none";
  content.style.display = "block";

  TAG_AXES.forEach((axis) => renderCompareAxisChart(axis, allEntries));
  renderNicheLeaderboard();
}

function renderCompareAxisChart(axis, allEntries) {
  renderAxisChart(document.getElementById(`compare-chart-${axis}`), compareCharts, axis, allEntries, compareMetric);
}

function renderNicheLeaderboard() {
  const body = document.getElementById("compare-niche-body");
  const emptyMsg = document.getElementById("compare-niche-empty");
  body.innerHTML = "";

  const names = allModelNames();
  const hasOrphans = accounts.some((a) => !a.niche || !a.niche.trim());
  const niches = hasOrphans ? [...names, ""] : names;

  const rows = niches
    .map((niche) => {
      const accs = accountsForNiche(niche);
      const accIds = new Set(accs.map((a) => a.id));
      const entriesList = entries.filter((e) => accIds.has(e.accountId));
      if (entriesList.length === 0) return null;
      const stats = computeModelStats(niche);
      return {
        name: niche === "" ? "Sans modèle" : niche,
        accountCount: accs.length,
        totalViews: stats.totalViews,
        avgViews: stats.totalViews / entriesList.length,
        avgEngagement: stats.avgEngagement,
        bestAccountName: stats.bestAccountName,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.avgViews - a.avgViews);

  if (rows.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    const rankClass = i === 0 ? "rank-badge rank-1" : "";
    tr.innerHTML = `
      <td class="${rankClass}">${i + 1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${r.accountCount}</td>
      <td>${formatCompact(r.totalViews)}</td>
      <td>${formatCompact(Math.round(r.avgViews))}</td>
      <td>${formatPercent(r.avgEngagement)}</td>
      <td>${escapeHtml(r.bestAccountName)}</td>
    `;
    body.appendChild(tr);
  });
}

function buildModelCard(niche, displayName) {
  const accs = accountsForNiche(niche);
  const accIds = new Set(accs.map((a) => a.id));
  const entriesList = entries.filter((e) => accIds.has(e.accountId));
  const totalViews = entriesList.reduce((s, e) => s + Number(e.views || 0), 0);

  const card = document.createElement("div");
  card.className = "model-card";
  card.dataset.modelId = niche;
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.innerHTML = `
    <h2 class="model-card-name">${escapeHtml(displayName)}</h2>
    <p class="model-card-stat">${accs.length} compte${accs.length > 1 ? "s" : ""} · ${formatCompact(totalViews)} vues</p>
  `;
  return card;
}

// --- level 1 : Modèle (tous ses comptes) -----------------------------------

function renderModelView() {
  const niche = currentNiche;
  const displayName = niche === "" ? "Sans modèle" : niche;

  document.getElementById("scoped-title").textContent = displayName;
  document.getElementById("scoped-subtitle").textContent = "";
  const breadcrumb = document.getElementById("breadcrumb-btn");
  breadcrumb.textContent = "← Modèles";
  breadcrumb.onclick = () => goToModels();

  const stats = computeModelStats(niche);
  setStatSlot("a", "Vues totales", formatCompact(stats.totalViews));
  setStatSlot("b", "Engagement moyen", formatPercent(stats.avgEngagement));
  setStatSlot("c", "Meilleur compte", stats.bestAccountName);
  setStatSlot("d", "Meilleur reel", stats.bestEntryLabel);

  renderModelAccountCards(niche);
}

function renderModelAccountCards(niche) {
  const wrap = document.getElementById("model-accounts");
  wrap.innerHTML = "";
  const accs = accountsForNiche(niche);

  if (accs.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">Aucun compte pour cette modèle. Ajoute-en un dans la barre latérale.</p>';
    return;
  }

  accs.forEach((acc) => {
    const color = channelColor(acc.id);
    const accEntries = entriesForAccount(acc.id).sort((a, b) => new Date(a.date) - new Date(b.date));

    const card = document.createElement("div");
    card.className = "account-card";
    card.dataset.accountId = acc.id;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    const head = document.createElement("div");
    head.className = "signal-row-head";
    const dot = document.createElement("span");
    dot.className = "signal-row-dot";
    dot.style.background = color;
    const name = document.createElement("span");
    name.className = "signal-row-name";
    name.textContent = acc.name;
    const statusBadge = document.createElement("span");
    statusBadge.className = `status-badge status-${acc.status}`;
    statusBadge.textContent = ACCOUNT_STATUS_LABELS[acc.status];
    const stat = document.createElement("span");
    stat.className = "signal-row-stat";
    if (accEntries.length > 0) {
      const total = accEntries.reduce((sum, e) => sum + Number(e.views || 0), 0);
      const avg = Math.round(total / accEntries.length);
      stat.textContent = `${accEntries.length} reels · moy. ${avg.toLocaleString("fr-FR")} vues`;
    } else {
      stat.textContent = "aucune entrée";
    }
    const headParts = [dot, name, statusBadge];
    // only for accounts that HAVE posted before but gone quiet since — a brand-new
    // account with zero entries already reads "aucune entrée", no need to pile on.
    const inactiveDays = daysSinceLastPost(acc.id);
    if (inactiveDays !== null && inactiveDays >= 7) {
      const inactiveBadge = document.createElement("span");
      inactiveBadge.className = "review-badge";
      inactiveBadge.textContent = `Inactif · ${inactiveDays}j`;
      headParts.push(inactiveBadge);
    }
    const del = document.createElement("button");
    del.className = "row-delete account-card-delete";
    del.textContent = "✕";
    del.title = "Supprimer ce compte";
    headParts.push(stat, del);
    head.append(...headParts);
    card.appendChild(head);

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "signal-row-canvas";
    canvasWrap.innerHTML = buildPulseTrace(accEntries, color);
    if (accEntries.length === 0) {
      const empty = document.createElement("span");
      empty.className = "signal-row-empty-label";
      empty.textContent = "Pas encore de signal pour ce compte.";
      canvasWrap.appendChild(empty);
    }
    card.appendChild(canvasWrap);

    wrap.appendChild(card);
  });
}

function deleteAccount(accountId) {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return;
  const entryCount = entries.filter((e) => e.accountId === accountId).length;
  const conversionCount = conversions.filter((c) => c.accountId === accountId).length;
  const ok = confirm(
    `Supprimer "${acc.name}" ? Cela supprime aussi ses ${entryCount} entrée${entryCount > 1 ? "s" : ""} et ${conversionCount} conversion${conversionCount > 1 ? "s" : ""}. Action irréversible.`
  );
  if (!ok) return;

  entries = entries.filter((e) => e.accountId !== accountId);
  conversions = conversions.filter((c) => c.accountId !== accountId);
  accounts = accounts.filter((a) => a.id !== accountId);
  saveEntriesLocal(entries);
  saveConversionsLocal(conversions);
  saveAccountsLocal(accounts);
  // on delete cascade (DB side) removes that account's entries/conversions in Supabase too —
  // no need to also queue separate deletes for them here.
  queueSync("accounts", "delete", { id: accountId });

  if (currentAccountId === accountId) goToModel(currentNiche);
  else renderCurrentView();
}

// --- level 2 : Compte (dashboard complet) -----------------------------------

function renderAccountView() {
  const acc = accounts.find((a) => a.id === currentAccountId);
  if (!acc) {
    goToModels();
    return;
  }

  document.getElementById("scoped-title").textContent = acc.name;
  document.getElementById("scoped-subtitle").textContent = "";
  const breadcrumb = document.getElementById("breadcrumb-btn");
  const displayNiche = acc.niche || "Sans modèle";
  breadcrumb.textContent = `← ${displayNiche}`;
  breadcrumb.onclick = () => goToModel(acc.niche || "");

  const stats = computeAccountStats(currentAccountId);
  setStatSlot("a", "Vues totales", formatCompact(stats.totalViews));
  setStatSlot("b", "Engagement moyen", formatPercent(stats.avgEngagement));
  setStatSlot("c", "Meilleur reel", stats.bestEntryLabel);
  setStatSlot("d", "Nouveaux abonnés", stats.totalNewSubs.toLocaleString("fr-FR"));

  renderAccountInfo(acc);
  document.getElementById("account-info-view").hidden = editingAccountInfo;
  document.getElementById("account-info-form").hidden = !editingAccountInfo;
  document.getElementById("account-info-edit-btn").hidden = editingAccountInfo;

  populateTagSelects();
  document.getElementById("entry-form-submit").textContent = editingEntryId ? "Mettre à jour l'entrée" : "Enregistrer l'entrée";
  document.getElementById("entry-form-cancel").hidden = !editingEntryId;
  renderActiveTab();
}

// --- account info card (creation date/method, status, warm-up, notes) ------

function renderAccountInfo(acc) {
  const view = document.getElementById("account-info-view");
  const created = acc.createdDate ? `${escapeHtml(acc.createdDate)} · ${daysSince(acc.createdDate)} j` : "—";
  view.innerHTML = `
    <div class="info-item">
      <span class="info-label">Créé le</span>
      <span class="info-value">${created}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Créé via</span>
      <span class="info-value">${escapeHtml(acc.creationMethod || "—")}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Statut</span>
      <span class="status-badge status-${acc.status}">${escapeHtml(ACCOUNT_STATUS_LABELS[acc.status])}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Warm-up</span>
      <span class="info-value">${escapeHtml(acc.warmup || "—")}</span>
    </div>
    <div class="info-item info-item-full">
      <span class="info-label">Notes</span>
      <span class="info-value">${escapeHtml(acc.accountNotes || "—")}</span>
    </div>
  `;
}

function startEditAccountInfo() {
  const acc = accounts.find((a) => a.id === currentAccountId);
  if (!acc) return;
  editingAccountInfo = true;
  document.getElementById("account-info-created").value = acc.createdDate || "";
  document.getElementById("account-info-method").value = acc.creationMethod || "";
  document.getElementById("account-info-status").value = acc.status || "actif";
  document.getElementById("account-info-warmup").value = acc.warmup || "";
  document.getElementById("account-info-notes").value = acc.accountNotes || "";
  document.getElementById("account-info-view").hidden = true;
  document.getElementById("account-info-form").hidden = false;
  document.getElementById("account-info-edit-btn").hidden = true;
}

function cancelEditAccountInfo() {
  editingAccountInfo = false;
  document.getElementById("account-info-view").hidden = false;
  document.getElementById("account-info-form").hidden = true;
  document.getElementById("account-info-edit-btn").hidden = false;
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

// --- tabs (within a single account's dashboard) ----------------------------

function renderActiveTab() {
  if (activeTab === "dashboard") renderTrendChart();
  if (activeTab === "insights") renderInsights();
  if (activeTab === "conversion") {
    renderConversionViewsChart();
    renderConversionMetricsChart();
    renderConversionLogTable();
  }
  if (activeTab === "journal") renderLogTable();
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
  renderActiveTab();
}

// --- pulse trace (reused for account cards at level 1) ----------------------

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

// --- dashboard tab: trend chart (single account) ----------------------------

function renderTrendChart() {
  const canvas = document.getElementById("trend-chart");
  const accEntries = entriesForAccount(currentAccountId).sort((a, b) => new Date(a.date) - new Date(b.date));
  const uniqueDates = [...new Set(accEntries.map((e) => e.date))].sort();
  const byDate = {};
  accEntries.forEach((e) => {
    byDate[e.date] = Number(e.views || 0);
  });
  const color = channelColor(currentAccountId);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: uniqueDates,
      datasets: [
        {
          label: accountName(currentAccountId),
          data: uniqueDates.map((d) => byDate[d]),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_INK }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_INK }, grid: { color: CHART_GRID } },
      },
    },
  });
}

// --- journal tab (single account) -------------------------------------------

function renderReviewBanner(accountEntries) {
  const banner = document.getElementById("review-banner");
  const staleCount = accountEntries.filter((e) => daysSince(e.date) >= 7).length;
  if (staleCount === 0) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.textContent =
    staleCount > 1
      ? `⚠️ ${staleCount} reels postés depuis plus de 7 jours — pense à vérifier/mettre à jour leurs stats définitives.`
      : `⚠️ 1 reel posté depuis plus de 7 jours — pense à vérifier/mettre à jour ses stats définitives.`;
}

function renderLogTable() {
  const body = document.getElementById("log-body");
  const emptyMsg = document.getElementById("log-empty");
  body.innerHTML = "";

  const accountEntries = entriesForAccount(currentAccountId);
  renderReviewBanner(accountEntries);

  const filtered = accountEntries.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  if (filtered.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  const maxViews = Math.max(...filtered.map((e) => Number(e.views || 0)), 0);

  filtered.forEach((e) => {
    const tr = document.createElement("tr");
    const isPeak = maxViews > 0 && Number(e.views || 0) === maxViews;
    const age = daysSince(e.date);
    const ageBadge = `<span class="${age >= 7 ? "review-badge" : "day-count"}">J+${age}</span>`;
    tr.innerHTML = `
      <td>${escapeHtml(e.date)}<br>${ageBadge}</td>
      <td>${entrySeqBadge(e)}${escapeHtml(entryLabel(e))}${tagChipsHtml(e.tags)}${soundNameHtml(e.soundName)}${duplicateOriginHtml(e)}</td>
      <td class="${isPeak ? "peak-views" : ""}">${Number(e.views || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.likes || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.comments || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.shares || 0).toLocaleString("fr-FR")}</td>
      <td class="notes-cell">${escapeHtml(e.notes || "")}</td>
    `;
    const actionsTd = document.createElement("td");
    actionsTd.className = "row-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "row-edit";
    editBtn.textContent = "✎";
    editBtn.title = "Modifier cette entrée";
    editBtn.addEventListener("click", () => startEditEntry(e.id));
    const delBtn = document.createElement("button");
    delBtn.className = "row-delete";
    delBtn.textContent = "✕";
    delBtn.title = "Supprimer cette entrée";
    delBtn.addEventListener("click", () => {
      entries = entries.filter((x) => x.id !== e.id);
      saveEntriesLocal(entries);
      queueSync("entries", "delete", { id: e.id });
      if (editingEntryId === e.id) cancelEditEntry();
      renderCurrentView();
    });
    actionsTd.append(editBtn, delBtn);
    tr.appendChild(actionsTd);
    body.appendChild(tr);
  });
}

function startEditEntry(entryId) {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return;
  editingEntryId = entryId;

  document.getElementById("entry-date").value = entry.date;
  document.getElementById("entry-label").value = entry.label || "";
  TAG_AXES.forEach((axis) => {
    const select = document.getElementById(`entry-tag-${axis}`);
    if (select) select.value = (entry.tags && entry.tags[axis]) || TAG_UNCLASSIFIED;
  });
  document.getElementById("entry-sound-name").value = entry.soundName || "";
  document.getElementById("entry-views").value = entry.views;
  document.getElementById("entry-likes").value = entry.likes;
  document.getElementById("entry-comments").value = entry.comments;
  document.getElementById("entry-shares").value = entry.shares;
  document.getElementById("entry-notes").value = entry.notes || "";

  document.getElementById("entry-form-submit").textContent = "Mettre à jour l'entrée";
  document.getElementById("entry-form-cancel").hidden = false;

  switchTab("journal");
}

function cancelEditEntry() {
  editingEntryId = null;
  pendingDuplicate = null;
  const form = document.getElementById("entry-form");
  form.reset();
  document.getElementById("entry-date").value = new Date().toISOString().slice(0, 10);
  populateTagSelects();
  document.getElementById("entry-form-submit").textContent = "Enregistrer l'entrée";
  document.getElementById("entry-form-cancel").hidden = true;
  renderDuplicateBanner();
}

function renderDuplicateBanner() {
  const banner = document.getElementById("duplicate-banner");
  if (!pendingDuplicate) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  document.getElementById("duplicate-banner-account").textContent = pendingDuplicate.accountName || "un compte";
  const seqPrefix = pendingDuplicate.seq != null ? `#${pendingDuplicate.seq} ` : "";
  document.getElementById("duplicate-banner-label").textContent = seqPrefix + (pendingDuplicate.label || "(sans label)");
}

// pre-fills the sidebar "new entry" form on the target account with the source reel's
// recipe (label/tags/son) so the user only has to confirm date + fresh stats — the
// resulting entry gets linked back to its origin once saved (see entry-form submit handler)
function startDuplicateFlow(sourceEntry, targetAccountId) {
  if (!targetAccountId) return;
  const sourceAccount = accounts.find((a) => a.id === sourceEntry.accountId);
  duplicatingEntryId = null;
  goToAccount(targetAccountId);
  pendingDuplicate = {
    entryId: sourceEntry.id,
    label: sourceEntry.label || "",
    tags: { ...sourceEntry.tags },
    soundName: sourceEntry.soundName || "",
    accountName: sourceAccount ? sourceAccount.name : "",
    seq: sourceEntry.seq,
  };
  switchTab("journal");
  document.getElementById("entry-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("entry-label").value = pendingDuplicate.label;
  TAG_AXES.forEach((axis) => {
    const select = document.getElementById(`entry-tag-${axis}`);
    if (!select) return;
    const tagValue = pendingDuplicate.tags[axis] || TAG_UNCLASSIFIED;
    const exists = [...select.options].some((o) => o.value === tagValue);
    select.value = exists ? tagValue : TAG_UNCLASSIFIED;
  });
  document.getElementById("entry-sound-name").value = pendingDuplicate.soundName;
  document.getElementById("entry-views").value = 0;
  document.getElementById("entry-likes").value = 0;
  document.getElementById("entry-comments").value = 0;
  document.getElementById("entry-shares").value = 0;
  document.getElementById("entry-notes").value = "";
  renderDuplicateBanner();
}

// --- insights tab (single account) ------------------------------------------

function computeAxisBreakdown(axis, filteredEntries, metric) {
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
  rows.sort((a, b) => (metric === "engagement" ? b.avgEngagement - a.avgEngagement : b.avgViews - a.avgViews));
  return rows;
}

// shared by the per-account Insights tab and the cross-model Comparer section —
// only the canvas, the chart-instance store and the entry scope differ.
function renderAxisChart(canvas, chartsStore, axis, filteredEntries, metric) {
  const rows = computeAxisBreakdown(axis, filteredEntries, metric).slice(0, 8);
  if (chartsStore[axis]) chartsStore[axis].destroy();

  const color = CHANNEL_COLORS[TAG_AXES.indexOf(axis) % CHANNEL_COLORS.length];
  const labels = rows.map((r) => r.tag);
  const data = rows.map((r) => (metric === "engagement" ? r.avgEngagement * 100 : r.avgViews));

  chartsStore[axis] = new Chart(canvas, {
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
              const val = metric === "engagement" ? formatPercent(row.avgEngagement) : formatCompact(row.avgViews) + " vues";
              return `${val} moy. (${row.count} vidéo${row.count > 1 ? "s" : ""})`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: CHART_INK }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_LEGEND, font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function renderInsightsAxisChart(axis, filteredEntries) {
  renderAxisChart(document.getElementById(`insights-chart-${axis}`), insightsCharts, axis, filteredEntries, insightsMetric);
}

// minimum videos sharing a tag before it's trusted enough to recommend —
// avoids a single lucky reel driving the "winning recipe".
const RECIPE_MIN_SAMPLES = 2;

function computeWinningRecipe(filteredEntries, metric) {
  return TAG_AXES.map((axis) => {
    const best = computeAxisBreakdown(axis, filteredEntries, metric).find(
      (row) => row.tag !== TAG_UNCLASSIFIED && row.count >= RECIPE_MIN_SAMPLES
    );
    return { axis, best: best || null };
  });
}

function renderInsightsRecipe(filteredEntries) {
  const card = document.getElementById("insights-recipe-card");
  const itemsEl = document.getElementById("insights-recipe-items");
  const hintEl = document.getElementById("insights-recipe-hint");

  const recipe = computeWinningRecipe(filteredEntries, insightsMetric);
  const known = recipe.filter((r) => r.best);

  if (known.length === 0) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  itemsEl.innerHTML = "";

  recipe.forEach(({ axis, best }) => {
    const item = document.createElement("div");
    item.className = "recipe-item";
    if (!best) {
      item.innerHTML = `
        <span class="recipe-axis">${TAG_AXIS_LABELS[axis]}</span>
        <span class="recipe-value recipe-value-empty">pas assez de données</span>
      `;
    } else {
      const metricText =
        insightsMetric === "engagement" ? formatPercent(best.avgEngagement) : `${formatCompact(best.avgViews)} vues`;
      item.innerHTML = `
        <span class="recipe-axis">${TAG_AXIS_LABELS[axis]}</span>
        <span class="recipe-value">${escapeHtml(best.tag)}</span>
        <span class="recipe-meta">${best.count} reels · ${metricText} moy.</span>
      `;
    }
    itemsEl.appendChild(item);
  });

  hintEl.textContent =
    known.length < TAG_AXES.length
      ? "Recommandation partielle — ajoute plus d'entrées taguées pour compléter la recette."
      : "Combo basé sur tes contenus les plus performants — priorité pour ta prochaine duplication.";
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
    const tr = document.createElement("tr");
    const rankClass = i === 0 ? "rank-badge rank-1" : "";
    tr.innerHTML = `
      <td class="${rankClass}">${i + 1}</td>
      <td>${escapeHtml(e.date)}</td>
      <td>${entrySeqBadge(e)}${escapeHtml(entryLabel(e))}${tagChipsHtml(e.tags)}${soundNameHtml(e.soundName)}${duplicateOriginHtml(e)}</td>
      <td>${Number(e.views || 0).toLocaleString("fr-FR")}</td>
      <td>${formatPercent(engagementRate(e))}</td>
    `;
    const dupTd = document.createElement("td");
    dupTd.className = "duplicate-cell";

    if (duplicatingEntryId === e.id) {
      const otherAccounts = accounts
        .filter((a) => a.id !== currentAccountId)
        .sort((a, b) => (a.niche + a.name).localeCompare(b.niche + b.name));

      if (otherAccounts.length === 0) {
        dupTd.innerHTML = `<span class="recipe-value-empty">Aucun autre compte</span>`;
      } else {
        const select = document.createElement("select");
        select.className = "duplicate-target-select";
        otherAccounts.forEach((a) => {
          const opt = document.createElement("option");
          opt.value = a.id;
          opt.textContent = `${a.niche || "Sans modèle"} · ${a.name}`;
          select.appendChild(opt);
        });
        const goBtn = document.createElement("button");
        goBtn.type = "button";
        goBtn.className = "btn-icon duplicate-btn";
        goBtn.textContent = "OK";
        goBtn.title = "Dupliquer vers ce compte";
        goBtn.addEventListener("click", () => startDuplicateFlow(e, select.value));
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "btn-icon duplicate-btn";
        cancelBtn.textContent = "✕";
        cancelBtn.title = "Annuler";
        cancelBtn.addEventListener("click", () => {
          duplicatingEntryId = null;
          renderInsightsLeaderboard(filteredEntries);
        });
        dupTd.append(select, goBtn, cancelBtn);
      }
    } else {
      const count = duplicateCountFor(e.id);
      const dupCount = document.createElement("span");
      dupCount.className = "duplicate-count";
      dupCount.textContent = count > 0 ? `🔁 ${count}` : "—";
      const dupBtn = document.createElement("button");
      dupBtn.type = "button";
      dupBtn.className = "btn-icon duplicate-btn";
      dupBtn.textContent = "Dupliquer";
      dupBtn.title = "Dupliquer ce contenu vers un autre compte";
      dupBtn.addEventListener("click", () => {
        duplicatingEntryId = e.id;
        renderInsightsLeaderboard(filteredEntries);
      });
      dupTd.append(dupCount, dupBtn);
    }

    tr.appendChild(dupTd);
    body.appendChild(tr);
  });
}

function renderInsights() {
  const filtered = entriesForAccount(currentAccountId);
  const emptyMsg = document.getElementById("insights-empty");
  const grid = document.getElementById("insights-grid");

  if (filtered.length === 0) {
    emptyMsg.style.display = "block";
    grid.style.display = "none";
    document.getElementById("insights-recipe-card").style.display = "none";
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
    renderInsightsRecipe(filtered);
  }

  renderInsightsLeaderboard(filtered);
}

// --- conversion tab (single account) ----------------------------------------

function computeDailyContentViews(accountId) {
  const byDate = {};
  entriesForAccount(accountId).forEach((e) => {
    byDate[e.date] = (byDate[e.date] || 0) + Number(e.views || 0);
  });
  return byDate;
}

function computeDailyConversions(accountId) {
  const byDate = {};
  conversions
    .filter((c) => c.accountId === accountId)
    .forEach((c) => {
      if (!byDate[c.date]) byDate[c.date] = { linkClicks: 0, newSubs: 0 };
      byDate[c.date].linkClicks += Number(c.linkClicks || 0);
      byDate[c.date].newSubs += Number(c.newSubs || 0);
    });
  return byDate;
}

// two small multiples instead of one dual-axis chart: views and conversion counts
// live on very different scales, and a shared y-axis would misrepresent one of them.
function renderConversionViewsChart() {
  const canvas = document.getElementById("conversion-views-chart");
  const emptyMsg = document.getElementById("conversion-views-empty");

  const viewsByDate = computeDailyContentViews(currentAccountId);
  const dates = Object.keys(viewsByDate).sort();

  if (dates.length === 0) {
    emptyMsg.style.display = "block";
    canvas.style.display = "none";
    if (conversionViewsChart) {
      conversionViewsChart.destroy();
      conversionViewsChart = null;
    }
    return;
  }
  emptyMsg.style.display = "none";
  canvas.style.display = "block";

  if (conversionViewsChart) conversionViewsChart.destroy();
  conversionViewsChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        {
          label: "Vues",
          data: dates.map((d) => viewsByDate[d]),
          borderColor: CHANNEL_COLORS[0],
          backgroundColor: CHANNEL_COLORS[0],
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_INK }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_INK }, grid: { color: CHART_GRID } },
      },
    },
  });
}

function renderConversionMetricsChart() {
  const canvas = document.getElementById("conversion-metrics-chart");
  const emptyMsg = document.getElementById("conversion-metrics-empty");

  const convByDate = computeDailyConversions(currentAccountId);
  const dates = Object.keys(convByDate).sort();

  if (dates.length === 0) {
    emptyMsg.style.display = "block";
    canvas.style.display = "none";
    if (conversionMetricsChart) {
      conversionMetricsChart.destroy();
      conversionMetricsChart = null;
    }
    return;
  }
  emptyMsg.style.display = "none";
  canvas.style.display = "block";

  if (conversionMetricsChart) conversionMetricsChart.destroy();
  conversionMetricsChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: dates,
      datasets: [
        {
          label: "Nouveaux abonnés",
          data: dates.map((d) => convByDate[d].newSubs),
          backgroundColor: CHANNEL_COLORS[2],
          borderRadius: 4,
          maxBarThickness: 20,
        },
        {
          label: "Clics lien bio",
          data: dates.map((d) => convByDate[d].linkClicks),
          backgroundColor: CHANNEL_COLORS[6],
          borderRadius: 4,
          maxBarThickness: 20,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: CHART_LEGEND, boxWidth: 10, font: { size: 11 } } },
      },
      scales: {
        x: { ticks: { color: CHART_INK }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_INK }, grid: { color: CHART_GRID } },
      },
    },
  });
}

function renderConversionLogTable() {
  const body = document.getElementById("conversion-log-body");
  const emptyMsg = document.getElementById("conversion-log-empty");
  body.innerHTML = "";

  const filtered = conversions
    .filter((c) => c.accountId === currentAccountId)
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (filtered.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  filtered.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.date)}</td>
      <td>${Number(c.linkClicks || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(c.newSubs || 0).toLocaleString("fr-FR")}</td>
    `;
    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "row-delete";
    delBtn.textContent = "✕";
    delBtn.title = "Supprimer cette entrée";
    delBtn.addEventListener("click", () => {
      conversions = conversions.filter((x) => x.id !== c.id);
      saveConversionsLocal(conversions);
      queueSync("conversions", "delete", { id: c.id });
      renderCurrentView();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    body.appendChild(tr);
  });
}

// --- event wiring ------------------------------------------------------------

document.getElementById("add-model-btn").addEventListener("click", () => {
  const name = window.prompt("Nom de la nouvelle modèle :");
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const exists = allModelNames().some((m) => m.toLowerCase() === trimmed.toLowerCase());
  if (!exists) {
    models.push(trimmed);
    saveModelsLocal(models);
    queueSync("models", "upsert", { name: trimmed });
  }
  goToModel(trimmed);
});

document.getElementById("models-grid").addEventListener("click", (e) => {
  const card = e.target.closest("[data-model-id]");
  if (!card) return;
  goToModel(card.dataset.modelId);
});
document.getElementById("models-grid").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest("[data-model-id]");
  if (!card) return;
  e.preventDefault();
  goToModel(card.dataset.modelId);
});

document.getElementById("model-accounts").addEventListener("click", (e) => {
  const delBtn = e.target.closest(".account-card-delete");
  if (delBtn) {
    const card = delBtn.closest("[data-account-id]");
    if (card) deleteAccount(card.dataset.accountId);
    return;
  }
  const card = e.target.closest("[data-account-id]");
  if (card) goToAccount(card.dataset.accountId);
});
document.getElementById("model-accounts").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (e.target.closest(".account-card-delete")) return; // let the button handle its own activation
  const card = e.target.closest("[data-account-id]");
  if (!card) return;
  e.preventDefault();
  goToAccount(card.dataset.accountId);
});

setupSegmented("insights-metric-toggle", (value) => {
  insightsMetric = value;
  renderInsights();
});

setupSegmented("compare-metric-toggle", (value) => {
  compareMetric = value;
  renderCompareSection();
});

document.getElementById("insights-leaderboard-sort").addEventListener("change", (e) => {
  insightsSort = e.target.value;
  renderInsights();
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.getElementById("add-account-btn").addEventListener("click", () => {
  const input = document.getElementById("new-account-input");
  const name = input.value.trim();
  if (!name) return;
  const newAccount = { id: uid(), name, niche: currentNiche || "" };
  accounts.push(newAccount);
  saveAccountsLocal(accounts);
  queueSync("accounts", "upsert", mapAccountToDb(normalizeAccount(newAccount)));
  input.value = "";
  renderCurrentView();
});
document.getElementById("new-account-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("add-account-btn").click();
  }
});

document.getElementById("entry-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!currentAccountId) return;
  const tags = {};
  TAG_AXES.forEach((axis) => {
    const select = document.getElementById(`entry-tag-${axis}`);
    tags[axis] = select ? select.value : TAG_UNCLASSIFIED;
  });
  const payload = {
    accountId: currentAccountId,
    date: document.getElementById("entry-date").value,
    label: document.getElementById("entry-label").value.trim(),
    tags,
    soundName: document.getElementById("entry-sound-name").value.trim(),
    views: document.getElementById("entry-views").value,
    likes: document.getElementById("entry-likes").value,
    comments: document.getElementById("entry-comments").value,
    shares: document.getElementById("entry-shares").value,
    notes: document.getElementById("entry-notes").value.trim(),
  };

  let savedEntry;
  if (editingEntryId) {
    const idx = entries.findIndex((x) => x.id === editingEntryId);
    if (idx !== -1) {
      entries[idx] = { ...entries[idx], ...payload };
      savedEntry = entries[idx];
    }
  } else {
    const dupFields = pendingDuplicate
      ? {
          duplicatedFromEntryId: pendingDuplicate.entryId,
          duplicatedFromAccountName: pendingDuplicate.accountName,
          duplicatedFromLabel: pendingDuplicate.label,
          duplicatedFromSeq: pendingDuplicate.seq,
        }
      : {};
    const nextSeq = Math.max(0, ...entriesForAccount(currentAccountId).map((x) => x.seq || 0)) + 1;
    savedEntry = { id: uid(), seq: nextSeq, ...dupFields, ...payload };
    entries.push(savedEntry);
  }
  saveEntriesLocal(entries);
  if (savedEntry) queueSync("entries", "upsert", mapEntryToDb(savedEntry));
  cancelEditEntry();
  renderCurrentView();
});

document.getElementById("entry-form-cancel").addEventListener("click", () => {
  cancelEditEntry();
});

document.getElementById("duplicate-banner-cancel").addEventListener("click", () => {
  cancelEditEntry();
});

document.getElementById("account-info-edit-btn").addEventListener("click", startEditAccountInfo);
document.getElementById("account-info-cancel").addEventListener("click", cancelEditAccountInfo);
document.getElementById("account-info-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const acc = accounts.find((a) => a.id === currentAccountId);
  if (!acc) return;
  acc.createdDate = document.getElementById("account-info-created").value;
  acc.creationMethod = document.getElementById("account-info-method").value.trim();
  acc.status = document.getElementById("account-info-status").value;
  acc.warmup = document.getElementById("account-info-warmup").value.trim();
  acc.accountNotes = document.getElementById("account-info-notes").value.trim();
  saveAccountsLocal(accounts);
  queueSync("accounts", "upsert", mapAccountToDb(acc));
  cancelEditAccountInfo();
  renderCurrentView();
});

document.getElementById("conversion-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!currentAccountId) return;
  upsertConversion(
    currentAccountId,
    document.getElementById("conversion-form-date").value,
    document.getElementById("conversion-form-clicks").value,
    document.getElementById("conversion-form-subs").value
  );
  e.target.reset();
  document.getElementById("conversion-form-date").value = new Date().toISOString().slice(0, 10);
  renderCurrentView();
});

wireTagAddButtons();

document.getElementById("entry-date").value = new Date().toISOString().slice(0, 10);
document.getElementById("conversion-form-date").value = new Date().toISOString().slice(0, 10);

boot();
