const STORAGE_ACCOUNTS = "signal_accounts";
const STORAGE_ENTRIES = "signal_entries";

const SERIES_COLORS = ["#ef4b7a", "#35d6bd", "#f5a623", "#7f77dd", "#5dcaa5", "#d4537e"];

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

// --- account management ----------------------------------------------

function renderAccountChips() {
  const wrap = document.getElementById("account-chips");
  wrap.innerHTML = "";
  if (accounts.length === 0) {
    const p = document.createElement("span");
    p.className = "signal-empty";
    p.textContent = "Ajoute un premier compte ci-dessous.";
    wrap.appendChild(p);
    return;
  }
  accounts.forEach((acc) => {
    const chip = document.createElement("span");
    chip.className = "account-chip";
    const label = document.createElement("span");
    label.textContent = acc.name;
    const del = document.createElement("button");
    del.textContent = "\u2715";
    del.title = "Supprimer ce compte (garde ses entr\u00e9es dans le journal)";
    del.addEventListener("click", () => {
      accounts = accounts.filter((a) => a.id !== acc.id);
      saveAccounts(accounts);
      renderAll();
    });
    chip.append(label, del);
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

// --- signal strip (one row per account, bars = views per entry) ------

function renderSignalStrip() {
  const wrap = document.getElementById("signal-strip");
  wrap.innerHTML = "";

  if (accounts.length === 0) {
    wrap.innerHTML = '<p class="signal-empty">Ajoute un compte pour voir son activit\u00e9 ici.</p>';
    return;
  }

  accounts.forEach((acc) => {
    const accEntries = entries
      .filter((e) => e.accountId === acc.id)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const row = document.createElement("div");
    row.className = "signal-row";

    const head = document.createElement("div");
    head.className = "signal-row-head";
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
      stat.textContent = "aucune entr\u00e9e";
    }
    head.append(name, stat);
    row.appendChild(head);

    if (accEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "signal-empty";
      empty.textContent = "Rien enregistr\u00e9 pour ce compte.";
      row.appendChild(empty);
    } else {
      const bars = document.createElement("div");
      bars.className = "signal-bars";
      const maxViews = Math.max(...accEntries.map((e) => Number(e.views || 0)), 1);
      const peakViews = maxViews;
      accEntries.forEach((e) => {
        const bar = document.createElement("div");
        bar.className = "signal-bar" + (Number(e.views || 0) === peakViews ? " is-peak" : "");
        const heightPct = Math.max(6, (Number(e.views || 0) / maxViews) * 100);
        bar.style.height = `${heightPct}%`;
        bar.title = `${e.variant} \u2014 ${Number(e.views || 0).toLocaleString("fr-FR")} vues (${e.date})`;
        bars.appendChild(bar);
      });
      row.appendChild(bars);
    }

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

  if (variantChart) variantChart.destroy();
  variantChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Vues",
          data,
          backgroundColor: "#ef4b7a",
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
        x: { ticks: { color: "#a49bb8" }, grid: { color: "#322c3d" } },
        y: { ticks: { color: "#f0ecf7", font: { size: 11 } }, grid: { display: false } },
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
    datasets = accounts.map((acc, idx) => {
      const byDate = {};
      entries.filter((e) => e.accountId === acc.id).forEach((e) => {
        byDate[e.date] = Number(e.views || 0);
      });
      return {
        label: acc.name,
        data: uniqueDates.map((d) => (byDate[d] !== undefined ? byDate[d] : null)),
        borderColor: SERIES_COLORS[idx % SERIES_COLORS.length],
        backgroundColor: SERIES_COLORS[idx % SERIES_COLORS.length],
        tension: 0.3,
        pointRadius: 3,
        spanGaps: true,
      };
    });
  } else {
    const byDate = {};
    entries.filter((e) => e.accountId === filter).forEach((e) => {
      byDate[e.date] = Number(e.views || 0);
    });
    datasets = [
      {
        label: accountName(filter),
        data: uniqueDates.map((d) => byDate[d]),
        borderColor: "#ef4b7a",
        backgroundColor: "#ef4b7a",
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
          labels: { color: "#f0ecf7", boxWidth: 10, font: { size: 11 } },
        },
      },
      scales: {
        x: { ticks: { color: "#a49bb8" }, grid: { color: "#322c3d" } },
        y: { ticks: { color: "#a49bb8" }, grid: { color: "#322c3d" } },
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
      <td>${e.date}</td>
      <td>${accountName(e.accountId)}</td>
      <td>${e.variant}</td>
      <td class="${isPeak ? "peak-views" : ""}">${Number(e.views || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.likes || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.comments || 0).toLocaleString("fr-FR")}</td>
      <td>${Number(e.shares || 0).toLocaleString("fr-FR")}</td>
      <td class="notes-cell">${e.notes || ""}</td>
    `;
    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "row-delete";
    delBtn.textContent = "\u2715";
    delBtn.title = "Supprimer cette entr\u00e9e";
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
