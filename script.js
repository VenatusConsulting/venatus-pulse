const STORAGE_ACCOUNTS = "signal_accounts";
const STORAGE_ENTRIES = "signal_entries";

// one color per channel — reused consistently across chips, pulse traces and charts
const CHANNEL_COLORS = ["#4ef2a0", "#48d7e8", "#e85fd0", "#f0b545", "#7c9cf0", "#f2685a"];

// --- storage --------------------------------------------------------

function loadAccounts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_ACCOUNTS)) || [];
  } catch {
    return [];
  }
}
function saveAccounts(accounts) {
  localStorage.setItem(STORAGE_ACCOUNTS, JSON.stringify(accounts));
}
function loadEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_ENTRIES)) || [];
  } catch {
    return [];
  }
}
function saveEntries(entries) {
  localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(entries));
}

let accounts = loadAccounts();
let entries = loadEntries();
let variantChart = null;
let trendChart = null;

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
  accounts.forEach((acc) => {
    const chip = document.createElement("span");
    chip.className = "account-chip";
    const dot = document.createElement("span");
    dot.className = "chip-dot";
    dot.style.background = channelColor(acc.id);
    const label = document.createElement("span");
    label.textContent = acc.name;
    const del = document.createElement("button");
    del.textContent = "\u2715";
    del.title = "Supprimer ce compte (garde ses entrées dans le journal)";
    del.addEventListener("click", () => {
      accounts = accounts.filter((a) => a.id !== acc.id);
      saveAccounts(accounts);
      renderAll();
    });
    chip.append(dot, label, del);
    wrap.appendChild(chip);
  });
}

function populateAccountSelects() {
  const entrySelect = document.getElementById("entry-account");
  const chartFilter = document.getElementById("chart-account-filter");
  const logFilter = document.getElementById("log-account-filter");

  const prevEntry = entrySelect.value;
  const prevChart = chartFilter.value;
  const prevLog = logFilter.value;

  entrySelect.innerHTML = "";
  chartFilter.innerHTML = '<option value="all">Tous les comptes</option>';
  logFilter.innerHTML = '<option value="all">Tous les comptes</option>';

  accounts.forEach((acc) => {
    const opt1 = document.createElement("option");
    opt1.value = acc.id;
    opt1.textContent = acc.name;
    entrySelect.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = acc.id;
    opt2.textContent = acc.name;
    chartFilter.appendChild(opt2);

    const opt3 = document.createElement("option");
    opt3.value = acc.id;
    opt3.textContent = acc.name;
    logFilter.appendChild(opt3);
  });

  if ([...entrySelect.options].some((o) => o.value === prevEntry)) entrySelect.value = prevEntry;
  if ([...chartFilter.options].some((o) => o.value === prevChart)) chartFilter.value = prevChart;
  if ([...logFilter.options].some((o) => o.value === prevLog)) logFilter.value = prevLog;
}

// --- console readout ---------------------------------------------------

function updateConsoleReadout() {
  const el = document.getElementById("console-readout");
  if (accounts.length === 0) {
    el.textContent = "AUCUN CANAL — ajoute un compte pour démarrer le suivi";
    return;
  }
  const chanLabel = accounts.length > 1 ? "CANAUX ACTIFS" : "CANAL ACTIF";
  const entryLabel = entries.length > 1 ? "ENTRÉES" : "ENTRÉE";
  let lastLabel = "AUCUN SIGNAL";
  if (entries.length > 0) {
    const lastDate = entries.map((e) => e.date).sort().slice(-1)[0];
    lastLabel = "DERNIER SIGNAL " + lastDate;
  }
  el.textContent = `${accounts.length} ${chanLabel} · ${entries.length} ${entryLabel} · ${lastLabel}`;
}

// --- signal strip (signature element: EKG-style pulse trace per account) ---

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
      const tip = `${escapeHtml(p.e.variant)} \u2014 ${Number(p.v).toLocaleString("fr-FR")} vues (${escapeHtml(p.e.date)})`;
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

  accounts.forEach((acc) => {
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
    const stat = document.createElement("span");
    stat.className = "signal-row-stat";
    if (accEntries.length > 0) {
      const total = accEntries.reduce((sum, e) => sum + Number(e.views || 0), 0);
      const avg = Math.round(total / accEntries.length);
      stat.textContent = `${accEntries.length} reels \u00b7 moy. ${avg.toLocaleString("fr-FR")} vues`;
    } else {
      stat.textContent = "aucune entrée";
    }
    head.append(dot, name, stat);
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

  const labels = filtered.map((e) => (filter === "all" ? `${e.variant} (${accountName(e.accountId)})` : e.variant));
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
        x: { ticks: { color: "#7fa89a" }, grid: { color: "#16332b" } },
        y: { ticks: { color: "#eaf6ef", font: { size: 11 } }, grid: { display: false } },
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
          labels: { color: "#eaf6ef", boxWidth: 10, font: { size: 11 } },
        },
      },
      scales: {
        x: { ticks: { color: "#7fa89a" }, grid: { color: "#16332b" } },
        y: { ticks: { color: "#7fa89a" }, grid: { color: "#16332b" } },
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
      <td>${escapeHtml(e.variant)}</td>
      <td class="${isPeak ? "peak-views" : ""}">${Number(e.views || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.likes || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.comments || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.shares || 0).toLocaleString("fr-FR")}</td>
      <td class="notes-cell">${escapeHtml(e.notes || "")}</td>
    `;
    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "row-delete";
    delBtn.textContent = "\u2715";
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

// --- boot / render all ---------------------------------------------------

function renderAll() {
  renderAccountChips();
  populateAccountSelects();
  updateConsoleReadout();
  renderSignalStrip();
  renderVariantChart();
  renderTrendChart();
  renderLogTable();
}

document.getElementById("add-account-btn").addEventListener("click", () => {
  const input = document.getElementById("new-account-input");
  const name = input.value.trim();
  if (!name) return;
  accounts.push({ id: uid(), name });
  saveAccounts(accounts);
  input.value = "";
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
  entries.push({
    id: uid(),
    accountId,
    date: document.getElementById("entry-date").value,
    variant: document.getElementById("entry-variant").value.trim(),
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

document.getElementById("chart-account-filter").addEventListener("change", () => {
  renderVariantChart();
  renderTrendChart();
});
document.getElementById("log-account-filter").addEventListener("change", renderLogTable);

document.getElementById("entry-date").value = new Date().toISOString().slice(0, 10);
renderAll();
