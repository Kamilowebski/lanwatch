// ============================================================================
// GLOBALS & STATE
// ============================================================================

let allDevices = [];
let filteredDevices = [];
let config = {};
let currentPage = 1;
const pageSize = 10;
let statusCache = {};
let adminPassword = "";
let currentTab = "filters";
let watchdogDevices = [];
let watchdogIntervals = {};
let watchdogHistory = {};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function saveAdminPassword(pass) {
  adminPassword = pass;
  if (pass) {
    try {
      localStorage.setItem("devicePanelAdminPassword", pass);
    } catch (e) {
      /* ignore */
    }
  }
}

function getAdminPassword() {
  if (!adminPassword) {
    try {
      adminPassword = localStorage.getItem("devicePanelAdminPassword") || "";
    } catch (e) {
      /* ignore */
    }
  }
  return adminPassword;
}

function saveWatchdogList() {
  try {
    localStorage.setItem("devicePanelWatchdog", JSON.stringify(watchdogDevices));
  } catch (e) {
    /* ignore */
  }
}

function loadWatchdogList() {
  try {
    const saved = localStorage.getItem("devicePanelWatchdog");
    if (saved) {
      watchdogDevices = JSON.parse(saved);
    }
  } catch (e) {
    /* ignore */
  }
}

function saveWatchdogHistory() {
  try {
    localStorage.setItem("devicePanelWatchdogHistory", JSON.stringify(watchdogHistory));
  } catch (e) {
    /* ignore */
  }
}

function loadWatchdogHistory() {
  try {
    const saved = localStorage.getItem("devicePanelWatchdogHistory");
    if (saved) {
      watchdogHistory = JSON.parse(saved);
    }
  } catch (e) {
    /* ignore */
  }
}

async function fetchAPI(url, options = {}) {
  const password = getAdminPassword();
  if (password && options.method !== "GET") {
    options.headers = options.headers || {};
    options.headers["X-Admin-Password"] = password;
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

function showError(message) {
  alert(message);
}

function showSuccess(message) {
  console.log("✓", message);
}

// ============================================================================
// LOAD DATA
// ============================================================================

async function loadDevices() {
  try {
    allDevices = await fetchAPI("/api/devices");
    applyFilters();
  } catch (error) {
    showError("Błąd przy wczytywaniu urządzeń: " + error.message);
  }
}

async function loadConfig() {
  try {
    config = await fetchAPI("/api/config");
    updateConfigUI();
  } catch (error) {
    showError("Błąd przy wczytywaniu konfiguracji: " + error.message);
  }
}

// ============================================================================
// FILTERING & PAGINATION
// ============================================================================

function applyFilters() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const typeFilter = document.getElementById("typeFilter").value;
  const areaFilter = document.getElementById("areaFilter").value;
  const statusFilter = document.getElementById("statusFilter").value;
  const addressModeFilter = document.getElementById("addressModeFilter").value;
  const keywordFilter = document.getElementById("keywordFilter").value.toLowerCase();
  const groupFilter = document.getElementById("groupFilter").value;

  filteredDevices = allDevices.filter((device) => {
    if (search) {
      const searchableText = [
        device.name,
        device.ip,
        device.area,
        device.type,
        device.note,
        (device.keywords || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!searchableText.includes(search)) return false;
    }

    if (typeFilter && device.type !== typeFilter) return false;
    if (areaFilter && device.area !== areaFilter) return false;
    if (addressModeFilter && device.addressMode !== addressModeFilter) return false;
    if (groupFilter && device.group !== groupFilter) return false;

    if (statusFilter) {
      const status = statusCache[device.name] || "unknown";
      if (status !== statusFilter) return false;
    }

    if (keywordFilter) {
      const keywords = (device.keywords || []).map((k) => k.toLowerCase());
      if (!keywords.some((k) => k.includes(keywordFilter))) return false;
    }

    return true;
  });

  currentPage = 1;
  renderDeviceList();
}

function getSortKey(device) {
  const sortBy = document.getElementById("sortSelect").value;
  if (sortBy === "status") {
    return statusCache[device.name] || "unknown";
  }
  return device[sortBy] || "";
}

function renderDeviceList() {
  const sorted = [...filteredDevices].sort((a, b) => {
    const keyA = getSortKey(a).toString().toLowerCase();
    const keyB = getSortKey(b).toString().toLowerCase();
    return keyA.localeCompare(keyB);
  });

  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const paged = sorted.slice(start, end);

  const container = document.getElementById("deviceList");
  container.innerHTML = "";

  if (paged.length === 0) {
    container.innerHTML = '<p class="muted">Brak urządzeń</p>';
    document.getElementById("pagination").innerHTML = "";
    return;
  }

  paged.forEach((device) => {
    const statusData = statusCache[device.name] || { status: "unknown", latency: null };
    const status = typeof statusData === "string" ? statusData : statusData.status;
    const latency = typeof statusData === "object" ? statusData.latency : null;
    
    const row = document.createElement("div");
    row.className = "deviceRow";

    const info = document.createElement("div");
    info.className = "deviceRowInfo";

    const name = document.createElement("div");
    name.className = "deviceRowName";
    name.textContent = device.name;
    info.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "deviceRowMeta";
    meta.textContent = `${device.area || "?"} • ${device.type}\n${device.ip || "N/A"}`;
    info.appendChild(meta);

    row.appendChild(info);

    // Status badge - kółko z ms/status
    const statusBadge = document.createElement("div");
    statusBadge.className = `deviceRowStatus ${status}`;
    if (status === "online" && latency) {
      statusBadge.textContent = latency + "ms";
      statusBadge.title = `Online (${latency}ms)`;
    } else if (status === "online") {
      statusBadge.textContent = "OK";
      statusBadge.title = "Online";
    } else if (status === "offline") {
      statusBadge.textContent = "✗";
      statusBadge.title = "Offline";
    } else {
      statusBadge.textContent = "?";
      statusBadge.title = "Nieznany status";
    }

    row.appendChild(statusBadge);

    // Akcje
    row.onclick = () => expandDevice(device, row);
    container.appendChild(row);
  });

  // Pagination
  const totalPages = Math.ceil(sorted.length / pageSize);
  const paginationDiv = document.getElementById("pagination");
  if (totalPages > 1) {
    const parts = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === currentPage) {
        parts.push(`<strong>${i}</strong>`);
      } else {
        parts.push(
          `<a href="javascript:void(0)" onclick="currentPage=${i}; renderDeviceList()">${i}</a>`
        );
      }
    }
    paginationDiv.innerHTML = parts.join(" ");
  } else {
    paginationDiv.innerHTML = "";
  }
}

// ============================================================================
// EXPAND & DETAILS
// ============================================================================

function expandDevice(device, row) {
  // Jeśli już rozwinięty, zawiń
  const existing = row.nextElementSibling;
  if (existing && existing.dataset.deviceExpanded === device.name) {
    existing.remove();
    return;
  }

  // Usuń inne rozwinięte
  document.querySelectorAll(".deviceRowDetails").forEach((el) => el.remove());

  // Stwórz details panel
  const details = document.createElement("div");
  details.className = "deviceRowDetails";
  details.dataset.deviceExpanded = device.name;

  const statusData = statusCache[device.name] || { status: "unknown", latency: null };
  const status = typeof statusData === "string" ? statusData : statusData.status;

  details.innerHTML = `
    <div class="detailsContent">
      <div class="detailsSection">
        <h4>Informacje</h4>
        <div class="detailRow">
          <span class="detailLabel">Nazwa:</span>
          <span class="detailValue">${device.name}</span>
        </div>
        <div class="detailRow">
          <span class="detailLabel">IP:</span>
          <span class="detailValue">${device.ip || "N/A"}</span>
        </div>
        <div class="detailRow">
          <span class="detailLabel">Typ:</span>
          <span class="detailValue">${device.type}</span>
        </div>
        <div class="detailRow">
          <span class="detailLabel">Obszar:</span>
          <span class="detailValue">${device.area || "N/A"}</span>
        </div>
        <div class="detailRow">
          <span class="detailLabel">Adresowanie:</span>
          <span class="detailValue">${device.addressMode}</span>
        </div>
        <div class="detailRow">
          <span class="detailLabel">Status:</span>
          <span class="detailValue statusBadge ${status}">${status}</span>
        </div>
        ${device.note ? `
        <div class="detailRow">
          <span class="detailLabel">Notatka:</span>
          <span class="detailValue">${device.note}</span>
        </div>
        ` : ""}
        ${device.keywords && device.keywords.length > 0 ? `
        <div class="detailRow">
          <span class="detailLabel">Słowa kluczowe:</span>
          <span class="detailValue">${device.keywords.join(", ")}</span>
        </div>
        ` : ""}
      </div>

      <div class="detailsActions">
        <button onclick="pingDevice('${device.name}'); event.stopPropagation();">Ping</button>
        <button onclick="launchSSH('${device.name}'); event.stopPropagation();">SSH</button>
        <button onclick="launchVNC('${device.name}'); event.stopPropagation();">VNC</button>
        <button onclick="addWatchdogFromDetails('${device.name}'); event.stopPropagation();">Dodaj do Watchdog</button>
      </div>
    </div>
  `;

  row.parentNode.insertBefore(details, row.nextSibling);
}

function addWatchdogFromDetails(name) {
  if (!watchdogDevices.includes(name)) {
    watchdogDevices.push(name);
    saveWatchdogList();
    startWatchdogPing(name);
    switchTab("watchdog");
    renderWatchdogList();
    showSuccess(`${name} dodane do Watchdog'a`);
  } else {
    showError(`${name} już monitorowane`);
  }
}

// ============================================================================
// PING & STATUS
// ============================================================================

async function pingDevice(name) {
  try {
    const result = await fetchAPI(`/api/ping-name?name=${encodeURIComponent(name)}`);
    statusCache[name] = {
      status: result.online ? "online" : "offline",
      latency: result.latencyMs,
      packetLoss: result.packetLoss
    };
    renderDeviceList();
    showSuccess(`${name}: ${result.online ? "Online (" + (result.latencyMs || "?") + "ms)" : "Offline"}`);
  } catch (error) {
    statusCache[name] = { status: "unknown", latency: null };
    renderDeviceList();
    showError(`Błąd pingowania ${name}: ${error.message}`);
  }
}

async function pingAll() {
  const targets = filteredDevices.map((d) => d.name);
  if (targets.length === 0) {
    showError("Brak urządzeń do pingowania");
    return;
  }

  showSuccess(`Pingowanie ${targets.length} urządzeń...`);

  const promises = targets.map((name) =>
    fetchAPI(`/api/ping-name?name=${encodeURIComponent(name)}`)
      .then((result) => {
        statusCache[name] = {
          status: result.online ? "online" : "offline",
          latency: result.latencyMs,
          packetLoss: result.packetLoss
        };
      })
      .catch(() => {
        statusCache[name] = { status: "unknown", latency: null };
      })
  );

  await Promise.all(promises);
  renderDeviceList();
  showSuccess("Pingowanie zakończone");
}

// ============================================================================
// TABS
// ============================================================================

function initTabs() {
  const tabButtons = document.querySelectorAll(".tabButton");
  tabButtons.forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  switchTab("filters");
}

function switchTab(tab) {
  currentTab = tab;

  // Hide all
  document.querySelectorAll(".tabContent").forEach((el) => {
    el.classList.remove("active");
  });
  document.querySelectorAll(".tabButton").forEach((el) => {
    el.classList.remove("active");
  });

  // Show selected
  const content = document.getElementById(`tab-${tab}`);
  if (content) {
    content.classList.add("active");
  }
  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");

  // Initialize tab content
  if (tab === "add") {
    renderAddDeviceForm();
  } else if (tab === "config") {
    renderConfigForm();
  } else if (tab === "watchdog") {
    renderWatchdogList();
  }
}

// ============================================================================
// FORMS
// ============================================================================

function renderAddDeviceForm() {
  const container = document.getElementById("addDeviceForm");
  container.innerHTML = `
    <form id="deviceForm">
      <label>
        Nazwa (np. T104-0192)
        <input type="text" name="name" required>
      </label>
      <label>
        IP
        <input type="text" name="ip" placeholder="192.168.1.1">
      </label>
      <label>
        Typ
        <select name="type">
          ${(config.types || []).map((t) => `<option value="${t}">${t}</option>`).join("")}
        </select>
      </label>
      <label>
        Obszar
        <select name="area">
          <option value=""></option>
          ${(config.areas || []).map((a) => `<option value="${a}">${a}</option>`).join("")}
        </select>
      </label>
      <label>
        Notatka
        <input type="text" name="note" placeholder="">
      </label>
      <label>
        Słowa kluczowe (oddziel przecinkami)
        <input type="text" name="keywords" placeholder="">
      </label>
      <button type="submit">Dodaj urządzenie</button>
    </form>
  `;

  document.getElementById("deviceForm").onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const device = {
      name: formData.get("name"),
      ip: formData.get("ip"),
      type: formData.get("type"),
      area: formData.get("area"),
      note: formData.get("note"),
      keywords: formData.get("keywords").split(",").map((k) => k.trim()),
      addressMode: "dhcp",
    };

    try {
      const password = getAdminPassword();
      if (!password) {
        const pass = prompt("Podaj hasło administratora:");
        if (!pass) return;
        saveAdminPassword(pass);
      }

      const response = await fetch("/api/devices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Password": getAdminPassword(),
        },
        body: JSON.stringify({ password: getAdminPassword(), device }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Błąd");
      }

      showSuccess("Urządzenie dodane");
      loadDevices();
      e.target.reset();
    } catch (error) {
      showError("Błąd: " + error.message);
    }
  };
}

function renderConfigForm() {
  const container = document.getElementById("configForm");
  container.innerHTML = `
    <form id="configEditForm">
      <label>
        Użytkownik SSH
        <input type="text" name="sshUser" value="${config.sshUser || ""}">
      </label>
      <label>
        Port VNC (lokalny)
        <input type="number" name="vncLocalPort" value="${config.vncLocalPort || 5900}">
      </label>
      <label>
        Port VNC (zdalny)
        <input type="number" name="vncRemotePort" value="${config.vncRemotePort || 5900}">
      </label>
      <label>
        Ścieżka VNC viewer
        <input type="text" name="vncViewerPath" placeholder="C:\\Program Files\\TigerVNC\\vncviewer.exe">
      </label>
      <button type="submit">Zapisz konfigurację</button>
    </form>
  `;

  document.getElementById("configEditForm").onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const newConfig = {
      sshUser: formData.get("sshUser"),
      vncLocalPort: parseInt(formData.get("vncLocalPort")),
      vncRemotePort: parseInt(formData.get("vncRemotePort")),
      vncViewerPath: formData.get("vncViewerPath"),
    };

    try {
      const password = getAdminPassword();
      if (!password) {
        const pass = prompt("Podaj hasło administratora:");
        if (!pass) return;
        saveAdminPassword(pass);
      }

      const response = await fetch("/api/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Password": getAdminPassword(),
        },
        body: JSON.stringify({ password: getAdminPassword(), config: newConfig }),
      });

      if (!response.ok) {
        throw new Error("Błąd zapisu");
      }

      loadConfig();
      showSuccess("Konfiguracja zapisana");
    } catch (error) {
      showError("Błąd: " + error.message);
    }
  };
}

function updateConfigUI() {
  // Update dropdowns in add form
  const typeSelect = document.querySelector("#deviceForm select[name='type']");
  const areaSelect = document.querySelector("#deviceForm select[name='area']");
  if (typeSelect) {
    typeSelect.innerHTML = (config.types || [])
      .map((t) => `<option value="${t}">${t}</option>`)
      .join("");
  }
  if (areaSelect) {
    areaSelect.innerHTML =
      '<option value=""></option>' +
      (config.areas || []).map((a) => `<option value="${a}">${a}</option>`).join("");
  }

  // Update filters
  const typeFilter = document.getElementById("typeFilter");
  const areaFilter = document.getElementById("areaFilter");
  const groupFilter = document.getElementById("groupFilter");

  typeFilter.innerHTML =
    '<option value="">Wszystkie typy</option>' +
    (config.types || []).map((t) => `<option value="${t}">${t}</option>`).join("");

  areaFilter.innerHTML =
    '<option value="">Wszystkie obszary</option>' +
    (config.areas || []).map((a) => `<option value="${a}">${a}</option>`).join("");

  groupFilter.innerHTML =
    '<option value="">Wszystkie</option>' +
    (config.groups || []).map((g) => `<option value="${g}">${g}</option>`).join("");
}

// ============================================================================
// QUICK CONNECT (SSH/VNC bez bazy)
// ============================================================================

async function quickConnect() {
  const target = document.getElementById("quickConnectTarget").value.trim();
  const type = document.getElementById("quickConnectType").value;

  if (!target) {
    showError("Podaj IP lub nazwę");
    return;
  }

  const password = getAdminPassword();
  if (!password) {
    const pass = prompt("Podaj hasło administratora:");
    if (!pass) return;
    saveAdminPassword(pass);
  }

  try {
    if (type === "ssh") {
      const response = await fetch("/api/ssh-tunnel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Password": getAdminPassword(),
        },
        body: JSON.stringify({
          password: getAdminPassword(),
          // Use a fake device object with target
          name: target,
          sshUser: config.sshUser || "",
          localPort: config.vncLocalPort,
          remotePort: config.vncRemotePort,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error);
      }

      const result = await response.json();
      showSuccess(result.message);
    } else if (type === "vnc") {
      // Direct VNC
      const response = await fetch("/api/vnc-direct", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Password": getAdminPassword(),
        },
        body: JSON.stringify({
          password: getAdminPassword(),
          name: target,
          localPort: config.vncLocalPort,
          remotePort: config.vncRemotePort,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error);
      }

      const result = await response.json();
      showSuccess(result.message);
    }
  } catch (error) {
    showError("Błąd: " + error.message);
  }
}

// ============================================================================
// DEVICE ACTIONS
// ============================================================================

function editDevice(device) {
  // TODO: Implement device editing modal
  alert("Edycja: " + device.name + "\nTBD");
}

async function launchSSH(name) {
  try {
    const password = getAdminPassword();
    if (!password) {
      const pass = prompt("Podaj hasło administratora:");
      if (!pass) return;
      saveAdminPassword(pass);
    }

    const response = await fetch("/api/ssh-tunnel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": getAdminPassword(),
      },
      body: JSON.stringify({ password: getAdminPassword(), name }),
    });

    if (!response.ok) throw new Error("Błąd");
    const result = await response.json();
    showSuccess(result.message);
  } catch (error) {
    showError("Błąd SSH: " + error.message);
  }
}

async function launchVNC(name) {
  try {
    const password = getAdminPassword();
    if (!password) {
      const pass = prompt("Podaj hasło administratora:");
      if (!pass) return;
      saveAdminPassword(pass);
    }

    const response = await fetch("/api/vnc-direct", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": getAdminPassword(),
      },
      body: JSON.stringify({ password: getAdminPassword(), name }),
    });

    if (!response.ok) throw new Error("Błąd");
    const result = await response.json();
    showSuccess(result.message);
  } catch (error) {
    showError("Błąd VNC: " + error.message);
  }
}

// ============================================================================
// WATCHDOG / MONITORING
// ============================================================================

async function addWatchdogDevice() {
  const target = document.getElementById("watchdogAddTarget").value.trim();
  if (!target) {
    showError("Podaj IP lub nazwę");
    return;
  }

  if (!watchdogDevices.includes(target)) {
    watchdogDevices.push(target);
    saveWatchdogList();
    document.getElementById("watchdogAddTarget").value = "";
    renderWatchdogList();
    startWatchdogPing(target);
  }
}

function removeWatchdogDevice(target) {
  watchdogDevices = watchdogDevices.filter((d) => d !== target);
  saveWatchdogList();
  stopWatchdogPing(target);
  renderWatchdogList();
}

function renderWatchdogList() {
  const container = document.getElementById("watchdogList");
  container.innerHTML = "";

  if (watchdogDevices.length === 0) {
    container.innerHTML = '<p class="muted">Brak monitorowanych urządzeń</p>';
    return;
  }

  watchdogDevices.forEach((target) => {
    const device = document.createElement("div");
    device.className = "watchdogDevice";

    const header = document.createElement("div");
    header.className = "watchdogDeviceHeader";

    const name = document.createElement("div");
    name.className = "watchdogDeviceName";
    name.textContent = target;
    header.appendChild(name);

    const removeBtn = document.createElement("button");
    removeBtn.className = "watchdogDeviceRemove";
    removeBtn.textContent = "Usuń";
    removeBtn.onclick = () => removeWatchdogDevice(target);
    header.appendChild(removeBtn);

    device.appendChild(header);

    // Stats
    const stats = document.createElement("div");
    stats.className = "watchdogStats";
    const history = watchdogHistory[target] || [];
    const online = history.filter((p) => p.online).length;
    const total = history.length;
    const avgLoss = total > 0 ? Math.round((history.reduce((sum, p) => sum + (p.packetLoss || 0), 0) / total)) : 0;
    
    if (total === 0) {
      stats.textContent = "Czekam na pierwszy ping...";
    } else {
      stats.textContent = `Pings: ${total} | Online: ${online} | Utr. pakietów: ${avgLoss}%`;
    }
    device.appendChild(stats);

    // Chart
    const chart = document.createElement("div");
    chart.className = "watchdogPingChart";
    
    if (history.length === 0) {
      chart.textContent = "Brak danych";
      chart.style.display = "flex";
      chart.style.alignItems = "center";
      chart.style.justifyContent = "center";
      chart.style.fontSize = "12px";
      chart.style.color = "var(--text-muted)";
    } else {
      const maxLatency = Math.max(...history.slice(-20).map(p => p.latencyMs || 0), 50);
      
      (history || []).slice(-20).forEach((ping) => {
        const bar = document.createElement("div");
        bar.className = `watchdogPingBar ${ping.online ? "online" : "offline"}`;
        
        if (ping.online && ping.latencyMs) {
          bar.style.height = Math.max(10, (ping.latencyMs / maxLatency) * 100) + "%";
        } else if (ping.online) {
          bar.style.height = "10%";
        } else {
          bar.style.height = "100%";
        }
        
        const time = new Date(ping.time).toLocaleTimeString();
        if (ping.online) {
          bar.title = `${ping.latencyMs || "?"}ms (${time})`;
        } else {
          bar.title = `Offline (${time})`;
        }
        chart.appendChild(bar);
      });
    }
    device.appendChild(chart);

    container.appendChild(device);
  });
}

function startWatchdogPing(target) {
  if (watchdogIntervals[target]) return;

  const ping = async () => {
    try {
      const result = await fetchAPI(`/api/ping?target=${encodeURIComponent(target)}`);
      const entry = {
        online: result.online,
        latencyMs: result.latencyMs || null,
        packetLoss: result.packetLoss || (result.online ? 0 : 100),
        time: new Date().toISOString(),
      };

      if (!watchdogHistory[target]) {
        watchdogHistory[target] = [];
      }
      watchdogHistory[target].push(entry);

      // Keep last 100 pings
      if (watchdogHistory[target].length > 100) {
        watchdogHistory[target].shift();
      }

      saveWatchdogHistory();

      // If current tab is watchdog, update display
      if (currentTab === "watchdog") {
        renderWatchdogList();
      }

      // Alert if just went offline
      const prevOnline = watchdogHistory[target].length > 1 ? watchdogHistory[target][watchdogHistory[target].length - 2].online : null;
      if (!result.online && prevOnline !== false) {
        console.warn(`⚠️ ${target} went OFFLINE`);
      }
    } catch (error) {
      console.error(`Watchdog ping error for ${target}:`, error);
      if (!watchdogHistory[target]) {
        watchdogHistory[target] = [];
      }
      watchdogHistory[target].push({
        online: false,
        latencyMs: null,
        packetLoss: 100,
        time: new Date().toISOString(),
      });
      saveWatchdogHistory();
    }
  };

  // Ping immediately
  ping();

  // Then every 30 seconds
  watchdogIntervals[target] = setInterval(ping, 30000);
}

function stopWatchdogPing(target) {
  if (watchdogIntervals[target]) {
    clearInterval(watchdogIntervals[target]);
    delete watchdogIntervals[target];
  }
}

// ============================================================================
// INIT
// ============================================================================

async function init() {
  // Load theme
  const themeBtn = document.getElementById("themeToggleButton");
  themeBtn.onclick = () => {
    document.documentElement.classList.toggle("theme-dark");
    try {
      const isDark = document.documentElement.classList.contains("theme-dark");
      localStorage.setItem("devicePanelTheme", isDark ? "dark" : "light");
    } catch (e) {
      /* ignore */
    }
  };

  // Load data
  await loadDevices();
  await loadConfig();
  initTabs();
  loadWatchdogList();
  loadWatchdogHistory();

  // Restore watchdog monitoring
  watchdogDevices.forEach((target) => startWatchdogPing(target));
  renderWatchdogList();

  // Event listeners
  document.getElementById("searchInput").addEventListener("input", applyFilters);
  document.getElementById("typeFilter").addEventListener("change", applyFilters);
  document.getElementById("areaFilter").addEventListener("change", applyFilters);
  document.getElementById("sortSelect").addEventListener("change", renderDeviceList);
  document.getElementById("statusFilter").addEventListener("change", applyFilters);
  document.getElementById("addressModeFilter").addEventListener("change", applyFilters);
  document.getElementById("keywordFilter").addEventListener("input", applyFilters);
  document.getElementById("groupFilter").addEventListener("change", applyFilters);
  document.getElementById("clearFiltersButton").addEventListener("click", () => {
    document.getElementById("searchInput").value = "";
    document.getElementById("typeFilter").value = "";
    document.getElementById("areaFilter").value = "";
    document.getElementById("statusFilter").value = "";
    document.getElementById("addressModeFilter").value = "";
    document.getElementById("keywordFilter").value = "";
    document.getElementById("groupFilter").value = "";
    applyFilters();
  });

  document.getElementById("pingAllButton").addEventListener("click", pingAll);
  document.getElementById("refreshButton").addEventListener("click", loadDevices);

  document.getElementById("quickConnectButton").addEventListener("click", quickConnect);
  document.getElementById("watchdogAddButton").addEventListener("click", addWatchdogDevice);

  // Auto-ping
  document.getElementById("autoPingToggle").addEventListener("change", () => {
    const isChecked = document.getElementById("autoPingToggle").checked;
    if (isChecked) {
      const interval = parseInt(document.getElementById("autoPingInterval").value);
      setInterval(pingAll, interval);
    }
  });

  renderDeviceList();
}

document.addEventListener("DOMContentLoaded", init);
