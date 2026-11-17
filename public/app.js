const elements = {
  categories: document.getElementById("device-category"),
  categoryForm: document.getElementById("category-form"),
  categoryList: document.getElementById("category-list"),
  categoryName: document.getElementById("category-name"),
  dependencyCount: document.getElementById("dependency-count"),
  dependencyCreateField: document.getElementById("dependency-create-field"),
  dependencyDialog: document.getElementById("dependency-dialog"),
  dependencyDialogTitle: document.getElementById("dependency-dialog-title"),
  dependencyOptions: document.getElementById("dependency-options"),
  dependencySearch: document.getElementById("dependency-search"),
  dependencyManagerSearch: document.getElementById("dependency-manager-search"),
  dependencyCurrentList: document.getElementById("dependency-current-list"),
  dependencyCandidateList: document.getElementById("dependency-candidate-list"),
  dependencyManagerCount: document.getElementById("dependency-manager-count"),
  saveDependencies: document.getElementById("save-dependencies"),
  deviceIp: document.getElementById("device-ip"),
  deviceHostName: document.getElementById("host-name"),
  deviceDialog: document.getElementById("device-dialog"),
  deviceForm: document.getElementById("device-form"),
  deviceList: document.getElementById("device-list"),
  deviceIpFeedback: document.getElementById("device-ip-feedback"),
  deviceDetailsDialog: document.getElementById("device-details-dialog"),
  deviceDetailsList: document.getElementById("device-details-list"),
  deviceDetailsTitle: document.getElementById("device-details-title"),
  editDeviceFromDetails: document.getElementById("edit-device-from-details"),
  manageDependenciesFromDetails: document.getElementById("manage-dependencies-from-details"),
  emptyState: document.getElementById("empty-state"),
  filterCategory: document.getElementById("filter-category"),
  filterLocation: document.getElementById("filter-location"),
  filterStatus: document.getElementById("filter-status"),
  locationForm: document.getElementById("location-form"),
  locationList: document.getElementById("location-list"),
  locationName: document.getElementById("location-name"),
  locations: document.getElementById("device-location"),
  monitorList: document.getElementById("monitor-list"),
  monitorCount: document.getElementById("monitor-count"),
  notifications: document.getElementById("notifications"),
  pingVisibleDevices: document.getElementById("ping-visible-devices"),
  pageIndicator: document.getElementById("page-indicator"),
  pageSize: document.getElementById("page-size-setting"),
  saveDevice: document.getElementById("save-device"),
  previousPage: document.getElementById("previous-page"),
  nextPage: document.getElementById("next-page"),
  search: document.getElementById("device-search"),
  sshUser: document.getElementById("ssh-user-setting"),
  sshSettingsForm: document.getElementById("ssh-settings-form"),
  hostNameFeedback: document.getElementById("host-name-feedback"),
};

const namedItemConfig = {
  category: {
    endpoint: "categories",
    form: elements.categoryForm,
    input: elements.categoryName,
    list: elements.categoryList,
    saveButton: document.getElementById("save-category"),
    cancelButton: document.getElementById("cancel-category-edit"),
    label: "kategorii",
    labelCapitalized: "Kategoria",
  },
  location: {
    endpoint: "locations",
    form: elements.locationForm,
    input: elements.locationName,
    list: elements.locationList,
    saveButton: document.getElementById("save-location"),
    cancelButton: document.getElementById("cancel-location-edit"),
    label: "lokalizacji",
    labelCapitalized: "Lokalizacja",
  },
};

let devices = [];
let categories = [];
let locations = [];
let sshUser = "";
let sshSettingsDirty = false;
let refreshVersion = 0;
let metadataRefreshedAt = 0;
let onlineTtlMs = 300000;
let lastSuccessfulRefresh = null;
function setConnectionState(state) {
  const indicator = document.getElementById("connection-indicator");
  if (!indicator) return;
  indicator.dataset.state = state;
  document.getElementById("connection-label").textContent = {
    connected: "Połączono", waiting: "Czekam na serwer", disconnected: "Utracono połączenie",
  }[state];
  document.getElementById("connection-time").textContent = lastSuccessfulRefresh
    ? `Odświeżono: ${lastSuccessfulRefresh.toLocaleTimeString("pl-PL")}` : "Brak udanego odświeżenia";
}
const editingIds = { category: null, location: null };
const allowedPageSizes = [10, 20, 50, 100];
function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ }
}
const savedPageSize = Number(readPreference("lanwatch-page-size"));
let pageSize = allowedPageSizes.includes(savedPageSize) ? savedPageSize : 20;
let currentPage = 1;
let categoryFilter = "";
let locationFilter = "";
let statusFilter = "";
let dependencyCurrentDeviceId = null;
let selectedDependencyIds = new Set();
let dependencyEditorDeviceId = null;
let stagedDependencyIds = new Set();
let statusExpiryTimer = null;
const expandedGroups = new Set();
const knownMonitorStatuses = new Map();
const pendingMonitorUpdates = new Set();
let hasLoadedMonitorStatuses = false;
let visiblePageDeviceIds = [];

async function api(url, options = {}) {
  const { timeoutMs = 15000, ...fetchOptions } = options;
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  const started = performance.now();
  let status;
  const report = (event, details, level) => window.lanwatchDiagnostics?.report(event,
    {requestId,url,method:options.method || "GET",durationMs:Math.round(performance.now()-started),...details},level);
  const slowTimer = window.setTimeout(()=>report("api.waiting",{},"warn"),8000);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        "X-Request-ID": requestId,
      },
    });
    status = response.status;
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(result?.error || "Nie udało się wykonać operacji.");
    return result;
  } catch (error) {
    report(controller.signal.aborted ? "api.timeout" : "api.error",{status,message:error.message,stack:error.stack});
    if (controller.signal.aborted) {
      throw new Error("Serwer nie odpowiedział w wyznaczonym czasie. Sprawdź, czy aplikacja działa w PowerShell. Przed ponownym zapisem odśwież listę — zapis mógł już dojść do skutku.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    window.clearTimeout(slowTimer);
  }
}

function notify(message, type = "success") {
  const alert = document.createElement("div");
  alert.className = `alert alert-${type} notification`;
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  const dialog = [...document.querySelectorAll("dialog[open]")].pop();
  if (dialog) {
    let messages = dialog.querySelector(".dialog-notifications");
    if (!messages) {
      messages = document.createElement("div");
      messages.className = "dialog-notifications";
      messages.setAttribute("aria-live", "polite");
      dialog.querySelector(".dialog-header").after(messages);
    }
    messages.append(alert);
  } else elements.notifications.append(alert);
  window.setTimeout(() => alert.remove(), 4500);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  savePreference("lanwatch-theme", theme);
  document.getElementById("theme-label").textContent =
    theme === "dark" ? "Jasny motyw" : "Ciemny motyw";
}

function renderSummary(summaryDevices, hasFilters) {
  const uniqueDevices = [...new Map(summaryDevices.map((device) => [device.id, device])).values()];
  document.getElementById("summary-devices-label").textContent =
    hasFilters ? "Maszyny w wynikach" : "Wszystkie maszyny";
  document.getElementById("summary-devices").textContent = uniqueDevices.length;
  document.getElementById("summary-online").textContent =
    uniqueDevices.filter((device) => device.status === "online").length;
  document.getElementById("summary-offline").textContent =
    uniqueDevices.filter((device) => device.status === "offline").length;
  document.getElementById("summary-unchecked").textContent =
    uniqueDevices.filter((device) => device.status === "unknown").length;
}

function renderSelect(select, items, selectedValue, itemLabel) {
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = items.length
    ? `Wybierz ${itemLabel}`
    : `Dodaj ${itemLabel} w Ustawieniach`;
  select.append(placeholder);

  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.name;
    select.append(option);
  }
  select.value = selectedValue || "";
}

function renderFilterSelect(select, items, label, selectedValue) {
  select.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = `Wszystkie ${label}`;
  select.append(allOption);
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.name;
    select.append(option);
  }
  select.value = selectedValue || "";
}

function renderNamedItems(type, items) {
  const config = namedItemConfig[type];
  config.list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "settings-empty";
    empty.textContent = `Nie dodano jeszcze ${config.label}.`;
    config.list.append(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "category-row";
    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = item.name;
    const actions = document.createElement("div");
    actions.className = "category-actions";
    const edit = document.createElement("button");
    edit.className = "btn btn-sm btn-outline-secondary";
    edit.type = "button";
    edit.textContent = "Edytuj";
    edit.addEventListener("click", () => startNamedItemEdit(type, item));
    const remove = document.createElement("button");
    remove.className = "btn btn-sm btn-outline-danger";
    remove.type = "button";
    remove.textContent = "Usuń";
    remove.addEventListener("click", () => removeNamedItem(type, item));
    actions.append(edit, remove);
    row.append(name, actions);
    config.list.append(row);
  }
}

function renderSettings() {
  const preserveFormSelection = elements.deviceDialog.open;
  renderSelect(
    elements.categories,
    categories.map((category) => ({ value: category.id, name: category.name })),
    preserveFormSelection ? elements.categories.value : "",
    "kategorię",
  );
  renderSelect(
    elements.locations,
    locations.map((location) => ({ value: location.name, name: location.name })),
    preserveFormSelection ? elements.locations.value : "",
    "lokalizację",
  );
  renderNamedItems("category", categories);
  renderNamedItems("location", locations);
  if (!categories.some((category) => String(category.id) === categoryFilter)) categoryFilter = "";
  if (!locations.some((location) => location.name === locationFilter)) locationFilter = "";
  renderFilterSelect(
    elements.filterCategory,
    categories.map((category) => ({ value: String(category.id), name: category.name })),
    "typy",
    categoryFilter,
  );
  renderFilterSelect(
    elements.filterLocation,
    locations.map((location) => ({ value: location.name, name: location.name })),
    "lokalizacje",
    locationFilter,
  );
  elements.pageSize.value = String(pageSize);
  if (!sshSettingsDirty && document.activeElement !== elements.sshUser) elements.sshUser.value = sshUser;
}

function renderDependencies(selectedIds = [], currentDeviceId = null) {
  selectedDependencyIds = new Set(selectedIds.map(Number));
  dependencyCurrentDeviceId = currentDeviceId;
  elements.dependencySearch.value = "";
  renderDependencyOptions();
}

function renderDependencyOptions() {
  const query = elements.dependencySearch.value.trim().toLocaleLowerCase("pl");
  const availableDevices = devices.filter((device) => device.id !== dependencyCurrentDeviceId);
  const matchingDevices = availableDevices.filter((device) => containsQuery(
    [device.hostName, device.groupName, device.ip, device.location, device.category],
    query,
  ));
  elements.dependencyOptions.replaceChildren();

  if (!availableDevices.length) {
    const empty = document.createElement("p");
    empty.className = "dependency-empty";
    empty.textContent = "Najpierw dodaj inne maszyny.";
    elements.dependencyOptions.append(empty);
  } else if (!matchingDevices.length) {
    const empty = document.createElement("p");
    empty.className = "dependency-empty";
    empty.textContent = "Nie znaleziono pasujących maszyn.";
    elements.dependencyOptions.append(empty);
  } else {
    for (const device of matchingDevices) {
      const option = document.createElement("label");
      option.className = "dependency-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(device.id);
      checkbox.checked = selectedDependencyIds.has(device.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedDependencyIds.add(device.id);
        else selectedDependencyIds.delete(device.id);
        renderDependencyCount();
      });

      const details = document.createElement("span");
      details.className = "dependency-option-details";
      const host = document.createElement("span");
      host.className = "dependency-option-host";
      host.textContent = device.hostName;
      const meta = document.createElement("span");
      meta.className = "dependency-option-meta";
      meta.textContent = [
        device.groupName,
        device.ip || "bez IP",
        device.location,
      ].filter(Boolean).join(" · ");
      details.append(host, meta);
      option.append(checkbox, details);
      elements.dependencyOptions.append(option);
    }
  }
  renderDependencyCount();
}

function renderDependencyCount() {
  elements.dependencyCount.textContent = `Wybrano ${selectedDependencyIds.size}`;
}

function renderDependencyManager() {
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  elements.dependencyCurrentList.replaceChildren();
  elements.dependencyCandidateList.replaceChildren();

  const currentDependencies = [...stagedDependencyIds]
    .map((id) => devicesById.get(id))
    .filter(Boolean)
    .sort((left, right) => left.hostName.localeCompare(right.hostName, "pl"));
  if (!currentDependencies.length) {
    const empty = document.createElement("p");
    empty.className = "dependency-empty";
    empty.textContent = "Nie wybrano zależności.";
    elements.dependencyCurrentList.append(empty);
  } else {
    for (const device of currentDependencies) {
      const item = document.createElement("div");
      item.className = "dependency-manager-item";
      item.setAttribute("role", "listitem");
      const name = document.createElement("span");
      name.textContent = device.hostName;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "dependency-remove-button";
      remove.textContent = "Usuń";
      remove.setAttribute("aria-label", `Usuń zależność ${device.hostName}`);
      remove.addEventListener("click", () => {
        stagedDependencyIds.delete(device.id);
        renderDependencyManager();
      });
      item.append(name, remove);
      elements.dependencyCurrentList.append(item);
    }
  }

  const query = elements.dependencyManagerSearch.value.trim().toLocaleLowerCase("pl");
  const candidates = devices
    .filter((device) =>
      device.id !== dependencyEditorDeviceId && !stagedDependencyIds.has(device.id))
    .filter((device) => containsQuery(
      [device.hostName, device.groupName, device.ip, device.location, device.category],
      query,
    ))
    .sort((left, right) => left.hostName.localeCompare(right.hostName, "pl"));
  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.className = "dependency-empty";
    empty.textContent = query
      ? "Nie znaleziono pasujących maszyn."
      : "Nie ma innych maszyn do dodania.";
    elements.dependencyCandidateList.append(empty);
  } else {
    for (const device of candidates) {
      const item = document.createElement("div");
      item.className = "dependency-manager-item";
      item.setAttribute("role", "listitem");
      const details = document.createElement("span");
      details.className = "dependency-manager-details";
      const name = document.createElement("strong");
      name.textContent = device.hostName;
      const meta = document.createElement("small");
      meta.textContent = [
        device.groupName,
        device.ip || "bez IP",
        device.location,
      ].filter(Boolean).join(" · ");
      details.append(name, meta);
      const add = document.createElement("button");
      add.type = "button";
      add.className = "dependency-add-button";
      add.textContent = "Dodaj";
      add.setAttribute("aria-label", `Dodaj zależność ${device.hostName}`);
      add.addEventListener("click", () => {
        stagedDependencyIds.add(device.id);
        renderDependencyManager();
      });
      item.append(details, add);
      elements.dependencyCandidateList.append(item);
    }
  }

  elements.dependencyManagerCount.textContent = stagedDependencyIds.size === 1
    ? "1 zależność po zapisaniu"
    : `${stagedDependencyIds.size} zależności po zapisaniu`;
}

function openDependencyManager(device) {
  dependencyEditorDeviceId = device.id;
  stagedDependencyIds = new Set(device.dependencyIds.map(Number));
  elements.dependencyDialogTitle.textContent = device.hostName;
  elements.dependencyManagerSearch.value = "";
  renderDependencyManager();
  if (elements.deviceDetailsDialog.open) elements.deviceDetailsDialog.close();
  elements.dependencyDialog.showModal();
}

async function saveDeviceDependencies() {
  if (!dependencyEditorDeviceId || elements.saveDependencies.disabled) return;
  elements.saveDependencies.disabled = true;
  elements.saveDependencies.textContent = "Zapisywanie…";
  try {
    const updatedDevice = await api(
      `/api/devices/${dependencyEditorDeviceId}/dependencies`,
      {
        method: "PUT",
        body: JSON.stringify({ dependencyIds: [...stagedDependencyIds] }),
      },
    );
    devices = devices.map((device) =>
      device.id === updatedDevice.id
        ? { ...device, dependencyIds: updatedDevice.dependencyIds }
        : device,
    );
    renderDevices();
    elements.dependencyDialog.close();
    notify(`Zależności maszyny „${updatedDevice.hostName}” zostały zapisane.`);
  } catch (error) {
    notify(error.message, "danger");
  } finally {
    elements.saveDependencies.disabled = false;
    elements.saveDependencies.textContent = "Zapisz zależności";
  }
}

function containsQuery(values, query) {
  return !query || values.some((value) =>
    String(value || "").toLocaleLowerCase("pl").includes(query),
  );
}

function updateDeviceIdentifierValidation() {
  const currentId = Number(document.getElementById("device-id").value) || null;
  const hostName = elements.deviceHostName.value.trim().toLocaleLowerCase("pl");
  const ip = elements.deviceIp.value.trim().toLocaleLowerCase("pl");
  const duplicateHost = hostName && devices.some((device) =>
    device.id !== currentId &&
    device.hostName.trim().toLocaleLowerCase("pl") === hostName,
  );
  const duplicateIp = ip && devices.some((device) =>
    device.id !== currentId &&
    device.ip.trim().toLocaleLowerCase("pl") === ip,
  );
  const hostMessage = duplicateHost ? "Ta nazwa hosta jest już przypisana do innej maszyny." : "";
  const ipMessage = duplicateIp ? "Ten adres IP jest już przypisany do innej maszyny." : "";
  elements.deviceHostName.setCustomValidity(hostMessage);
  elements.deviceIp.setCustomValidity(ipMessage);
  elements.deviceHostName.setAttribute("aria-invalid", String(Boolean(hostMessage)));
  elements.deviceIp.setAttribute("aria-invalid", String(Boolean(ipMessage)));
  elements.hostNameFeedback.textContent = hostMessage;
  elements.deviceIpFeedback.textContent = ipMessage;
}

function isTerminalDevice(device) {
  return device.category.toLocaleLowerCase("pl") === "terminal";
}

function scheduleStatusExpiry(ttlMs) {
  window.clearTimeout(statusExpiryTimer);
  const nextExpiry = devices
    .filter((device) => device.status === "online" && device.statusCheckedAt)
    .map((device) => Date.parse(device.statusCheckedAt) + ttlMs)
    .filter((expiry) => Number.isFinite(expiry))
    .sort((left, right) => left - right)[0];
  if (nextExpiry === undefined) return;
  statusExpiryTimer = window.setTimeout(() => {
    refresh().catch((error) => notify(error.message, "danger"));
  }, Math.max(5000, nextExpiry - Date.now() + 50));
}

function makeCell(text, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text || "—";
  return cell;
}

function groupDevices() {
  const grouped = new Map();
  for (const device of devices) {
    const groupName = (device.groupName || "").trim();
    const key = groupName
      ? `group:${groupName.toLocaleLowerCase("pl")}`
      : `device:${device.id}`;
    if (!grouped.has(key)) {
      grouped.set(key, { key, groupName, devices: [] });
    }
    grouped.get(key).devices.push(device);
  }
  return Array.from(grouped.values()).sort((left, right) =>
    (left.groupName || left.devices[0].hostName)
      .localeCompare(right.groupName || right.devices[0].hostName, "pl"),
  );
}

function matchesDeviceQuery(group, query) {
  const searchableValues = [
    group.groupName,
    ...group.devices.flatMap((device) => [
      device.hostName,
      device.groupName,
      device.ip,
      device.location,
      device.category,
    ]),
  ];
  return containsQuery(searchableValues, query);
}

function searchRelatedGroups(query) {
  const groups = groupDevices();
  if (!query) return groups;

  const groupsByDeviceId = new Map();
  const groupsByKey = new Map(groups.map((group) => [group.key, group]));
  const neighbors = new Map(groups.map((group) => [group.key, new Set()]));
  for (const group of groups) {
    for (const device of group.devices) groupsByDeviceId.set(device.id, group);
  }
  for (const device of devices) {
    const source = groupsByDeviceId.get(device.id);
    for (const dependencyId of device.dependencyIds) {
      const target = groupsByDeviceId.get(dependencyId);
      if (source && target && source.key !== target.key) {
        neighbors.get(source.key).add(target.key);
        neighbors.get(target.key).add(source.key);
      }
    }
  }

  const matchingGroups = groups.filter((group) => matchesDeviceQuery(group, query));
  const matchedKeys = new Set(matchingGroups.map((group) => group.key));
  const visited = new Set();
  const results = [];
  for (const group of matchingGroups) {
    if (visited.has(group.key)) continue;
    const component = new Set();
    const pending = [group.key];
    while (pending.length) {
      const key = pending.pop();
      if (component.has(key)) continue;
      component.add(key);
      visited.add(key);
      pending.push(...neighbors.get(key));
    }
    if (component.size === 1) {
      results.push(groupsByKey.get(group.key));
      continue;
    }
    const componentGroups = groups.filter((candidate) => component.has(candidate.key));
    const names = componentGroups
      .filter((candidate) => matchedKeys.has(candidate.key))
      .map((candidate) => candidate.groupName || candidate.devices[0].hostName);
    results.push({
      key: `related:${[...component].sort().join("|")}`,
      related: true,
      relatedName: names.join(" · "),
      devices: componentGroups.flatMap((candidate) => candidate.devices),
    });
  }
  return results;
}

function matchesDeviceFilters(group) {
  return (!categoryFilter || group.devices.some((device) => String(device.categoryId) === categoryFilter))
    && (!locationFilter || group.devices.some((device) => device.location === locationFilter))
    && (!statusFilter || group.devices.some((device) => device.status === statusFilter));
}

function summaryValues(groupDevicesList, property, fallback = "—") {
  const values = [...new Set(groupDevicesList.map((device) => device[property]).filter(Boolean))];
  if (!values.length) return fallback;
  return values.length > 2 ? `${values.slice(0, 2).join(", ")} +${values.length - 2}` : values.join(", ");
}

function statusSummary(groupDevicesList) {
  const total = groupDevicesList.length;
  const online = groupDevicesList.filter((device) => device.status === "online").length;
  const offline = groupDevicesList.filter((device) => device.status === "offline").length;
  const unchecked = groupDevicesList.filter((device) => !device.statusCheckedAt).length;
  let label;
  if (online === total) label = total === 1 ? "Online" : `Online · ${total}`;
  else if (offline === total) label = total === 1 ? "Brak odpowiedzi" : `Brak odpowiedzi · ${total}`;
  else if (online === 0 && offline === 0 && unchecked === total) label = "Nie sprawdzono";
  else if (online === 0 && offline === 0) label = "Nieustalony";
  else if (online && offline) label = `${online} online · ${offline} bez odp.`;
  else if (online) label = `${online}/${total} online`;
  else label = `${offline}/${total} bez odpowiedzi`;

  const status = online === total ? "online" : offline === total ? "offline" : "unknown";
  return { label, status, online, offline, total };
}

function appendStatusCell(row, relatedDevices, representative, subjectLabel) {
  const cell = document.createElement("td");
  const summary = statusSummary(relatedDevices);
  const status = document.createElement("button");
  status.type = "button";
  status.className = `status-badge status-trigger status-${summary.status}`;
  status.textContent = summary.label;
  status.title = relatedDevices.length > 1
    ? `Kliknij, aby sprawdzić ping dla ${subjectLabel} i jego zależności.`
    : representative.statusMessage || "Kliknij, aby sprawdzić ping i zależności.";
  status.setAttribute(
    "aria-label",
    `Status ${subjectLabel}: ${summary.label}. Kliknij, aby sprawdzić.`,
  );
  status.addEventListener("click", () => pingDevice(representative, status));
  cell.append(status);

  const latestCheck = relatedDevices
    .map((device) => device.statusCheckedAt)
    .filter(Boolean)
    .sort()
    .pop();
  cell.classList.add("device-status-cell");
  const checkedAt = document.createElement("small");
  checkedAt.className = "status-time";
  checkedAt.textContent = latestCheck ? new Date(latestCheck).toLocaleString("pl-PL") : "\u00a0";
  cell.append(checkedAt);
  row.append(cell);
}

function dependencyNames(relatedDevices) {
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const names = [...new Set(relatedDevices.flatMap((device) => device.dependencyIds)
    .map((dependencyId) => devicesById.get(dependencyId)?.hostName)
    .filter(Boolean))];
  if (names.length > 2) return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  return names.join(", ") || "—";
}

function appendDependencyCell(row, relatedDevices) {
  row.append(makeCell(dependencyNames(relatedDevices), "dependency-cell"));
}

let historyRequestVersion = 0;
function openDeviceHistory(device) {
  const version = ++historyRequestVersion;
  const list = document.getElementById("history-list");
  const message = document.getElementById("history-message");
  const more = document.getElementById("history-more");
  const panel = document.getElementById("history-table-wrap");
  const count = document.getElementById("history-count");
  list.replaceChildren();
  panel.hidden = true;
  count.textContent = "0 wpisów";
  more.hidden = true;
  async function load(before) {
    more.disabled = true;
    panel.setAttribute("aria-busy", "true");
    message.dataset.state = "loading";
    message.hidden = false;
    message.textContent = "Wczytywanie historii…";
    try {
      const page = await api(`/api/devices/${device.id}/history${before ? `?before=${before}` : ""}`);
      if (version !== historyRequestVersion) return;
      const labels = {online: "Online", offline: "Brak odpowiedzi", unknown: "Nieustalony"};
      for (const entry of page.items) {
        const row = document.createElement("tr");
        const date = new Date(entry.checkedAt);
        const timeCell = document.createElement("td");
        const time = document.createElement("time");
        time.dateTime = entry.checkedAt;
        time.textContent = date.toLocaleTimeString("pl-PL");
        const day = document.createElement("small");
        day.textContent = date.toLocaleDateString("pl-PL", {day:"numeric", month:"short", year:"numeric"});
        timeCell.append(time, day);
        const statusCell = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = `history-status status-${entry.status}`;
        badge.textContent = labels[entry.status] || "Nieustalony";
        statusCell.append(badge);
        const targetCell = document.createElement("td");
        const target = document.createElement("span");
        target.className = "history-target";
        target.textContent = entry.target || "—";
        const detail = document.createElement("small");
        detail.textContent = entry.message || `Odpowiedzi ICMP: ${entry.replies}`;
        targetCell.append(target, detail);
        const latency = document.createElement("td");
        latency.className = "history-latency";
        latency.textContent = entry.latencyMs == null ? "—" : new Intl.NumberFormat("pl-PL", {maximumFractionDigits:2}).format(entry.latencyMs);
        if (entry.latencyMs != null) {
          const unit = document.createElement("span");
          unit.textContent = " ms";
          latency.append(unit);
        }
        row.append(timeCell, statusCell, targetCell, latency);
        list.append(row);
      }
      panel.hidden = list.children.length === 0;
      count.textContent = `Wyświetlono: ${list.children.length}`;
      message.dataset.state = "empty";
      message.hidden = list.children.length > 0;
      message.textContent = "Jeszcze bez sprawdzeń. Wykonaj ping lub włącz monitoring — tutaj pojawią się wyniki.";
      more.textContent = "Pokaż starsze wpisy";
      more.hidden = page.nextBefore === null;
      more.onclick = () => load(page.nextBefore);
    } catch (error) {
      if (version !== historyRequestVersion) return;
      message.dataset.state = "error";
      message.textContent = error.message;
      more.textContent = "Spróbuj ponownie";
      more.hidden = false;
      more.onclick = () => load(before);
    } finally {
      if (version === historyRequestVersion) {
        more.disabled = false;
        panel.setAttribute("aria-busy", "false");
      }
    }
  }
  load();
}

function openDeviceDetails(device) {
  openDeviceHistory(device);
  elements.deviceDetailsTitle.textContent = device.hostName;
  elements.deviceDetailsList.replaceChildren();
  const devicesById = new Map(devices.map((item) => [item.id, item]));
  const detailValues = [
    ["Adres IP", device.ip],
    ["Grupa", device.groupName],
    ["Lokalizacja", device.location],
    ["Typ", device.category],
    ["Nr linii", device.lineNumber],
    ["Numerator", device.numerator],
    ["Zależności", device.dependencyIds
      .map((dependencyId) => devicesById.get(dependencyId)?.hostName)
      .filter(Boolean)
      .join(", ")],
    ["Opis", device.description],
  ];
  for (const [label, value] of detailValues) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value || "—";
    elements.deviceDetailsList.append(term, description);
  }
  elements.editDeviceFromDetails.onclick = () => {
    elements.deviceDetailsDialog.close();
    openDeviceForm(device);
  };
  elements.manageDependenciesFromDetails.onclick = () => openDependencyManager(device);
  elements.deviceDetailsDialog.showModal();
}

function categoryIcon(category) {
  const icons = {
    terminal: "M4 5h16v14H4z M7 9l3 3-3 3 M12 15h4",
    komputer: "M3 4h18v13H3z M8 21h8 M12 17v4",
    server: "M4 3h16v7H4z M4 14h16v7H4z M7 6h.01 M7 17h.01 M11 6h6 M11 17h6",
    drukarka: "M6 8V3h12v5 M6 17H3V8h18v9h-3 M6 14h12v7H6z M17 11h.01",
    "raspberry pi": "M6 6h12v12H6z M9 9h6v6H9z M9 3v3 M15 3v3 M9 18v3 M15 18v3 M3 9h3 M3 15h3 M18 9h3 M18 15h3",
    kamera: "M3 7h12v11H3z M15 10l6-3v11l-6-3z",
    detektor: "M12 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2 M8 8a6 6 0 0 0 0 8 M16 8a6 6 0 0 1 0 8 M5 5a10 10 0 0 0 0 14 M19 5a10 10 0 0 1 0 14",
    waga: "M12 3v17 M5 20h14 M4 7h16 M6 7l-4 8h8z M18 7l-4 8h8z",
    bizerba: "M4 10h16v10H4z M7 3h10v7H7z M8 14h3 M8 17h8 M16 14h.01",
    minebea: "M3 8h18v12H3z M7 3h10v5 M7 12h10 M7 16h4 M17 16h.01",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("category-icon");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", icons[String(category || "").toLocaleLowerCase("pl").trim()] || "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z");
  svg.append(path);
  return svg;
}

function renderDeviceRow(device, isGroupMember = false) {
  const row = document.createElement("tr");
  row.dataset.deviceIds = String(device.id);
  row.dataset.subjectLabel = device.hostName;
  if (isGroupMember) row.className = "group-member-row";
  const hostCell = document.createElement("td");
  hostCell.className = "host-cell";
  const hostName = document.createElement("button");
  hostName.type = "button";
  hostName.className = "host-detail-trigger";
  hostName.textContent = device.hostName;
  hostName.prepend(categoryIcon(device.category));
  hostName.addEventListener("click", () => openDeviceDetails(device));
  hostCell.append(hostName);
  if (device.lineNumber) {
    const lineNumber = document.createElement("small");
    lineNumber.className = "line-number-cell";
    lineNumber.textContent = `Linia ${device.lineNumber}`;
    hostCell.append(lineNumber);
  }
  if (device.groupName && !isGroupMember) {
    const groupName = document.createElement("small");
    groupName.className = "group-name-cell";
    groupName.textContent = device.groupName;
    hostCell.append(groupName);
  }
  row.append(hostCell, makeCell(device.location));

  const categoryCell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = "category-badge";
  badge.textContent = device.category;
  categoryCell.append(badge);
  row.append(categoryCell);
  appendDependencyCell(row, [device]);
  appendStatusCell(row, [device], device, device.hostName);

  const actionsCell = document.createElement("td");
  actionsCell.className = "actions-cell";
  const monitor = document.createElement("button");
  monitor.className = "row-action";
  monitor.type = "button";
  monitor.textContent = device.monitorEnabled ? "Wyłącz monitor" : "Monitor";
  monitor.setAttribute(
    "aria-label",
    `${device.monitorEnabled ? "Wyłącz monitor" : "Włącz monitor"}: ${device.hostName}`,
  );
  monitor.addEventListener("click", () => saveMonitorSettings(device, {
    enabled: !device.monitorEnabled,
    notifyOnline: Boolean(device.notifyOnline),
    notifyOffline: Boolean(device.notifyOffline),
  }));
  actionsCell.append(monitor);
  if (isTerminalDevice(device)) {
    const terminal = document.createElement("button");
    terminal.className = "row-action";
    terminal.type = "button";
    terminal.textContent = "Tunel VNC";
    terminal.title = sshUser
      ? `Uruchom tunel SSH jako ${sshUser} w nowym oknie PowerShell`
      : "Najpierw ustaw globalnego użytkownika SSH w Ustawieniach.";
    terminal.addEventListener("click", () => openTunnelInPowerShell(device, terminal));
    actionsCell.append(terminal);
  }
  const edit = document.createElement("button");
  edit.className = "row-action";
  edit.type = "button";
  edit.textContent = "Edytuj";
  edit.addEventListener("click", () => openDeviceForm(device));
  const manageDependencies = document.createElement("button");
  manageDependencies.className = "row-action";
  manageDependencies.type = "button";
  manageDependencies.textContent = "Zależności";
  manageDependencies.addEventListener("click", () => openDependencyManager(device));
  const remove = document.createElement("button");
  remove.className = "row-action row-action-danger";
  remove.type = "button";
  remove.textContent = "Usuń";
  remove.addEventListener("click", () => removeDevice(device));
  actionsCell.append(manageDependencies, edit, remove);
  row.append(actionsCell);
  return row;
}

function renderGroupSummaryRow(group) {
  const row = document.createElement("tr");
  row.dataset.deviceIds = group.devices.map((device) => device.id).join(",");
  row.dataset.subjectLabel = group.relatedName || group.groupName;
  const hostCell = document.createElement("td");
  hostCell.className = "host-cell group-summary-cell";
  const name = document.createElement("span");
  name.textContent = group.relatedName || group.groupName;
  name.className = "group-title-with-icon";
  const categories = new Set(group.devices.map(device => device.category));
  name.prepend(categoryIcon(categories.size === 1 ? group.devices[0].category : ""));
  const count = document.createElement("small");
  count.className = "group-name-cell";
  count.textContent = group.related
    ? `Połączone zależności: ${group.devices.length} maszyn`
    : `Liczba urządzeń: ${group.devices.length}`;
  hostCell.append(name, count);
  row.append(hostCell);
  row.append(makeCell(summaryValues(group.devices, "location")));

  const categoryCell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = "category-badge";
  badge.textContent = summaryValues(group.devices, "category");
  categoryCell.append(badge);
  row.append(categoryCell);
  appendDependencyCell(row, group.devices);
  appendStatusCell(
    row,
    group.devices,
    group.devices[0],
    group.relatedName || group.groupName,
  );

  const actionsCell = document.createElement("td");
  actionsCell.className = "actions-cell";
  const toggle = document.createElement("button");
  toggle.className = "row-action";
  toggle.type = "button";
  toggle.textContent = expandedGroups.has(group.key) ? "Zwiń" : "Rozwiń";
  toggle.setAttribute("aria-expanded", String(expandedGroups.has(group.key)));
  toggle.addEventListener("click", () => {
    if (expandedGroups.has(group.key)) expandedGroups.delete(group.key);
    else expandedGroups.add(group.key);
    renderDevices();
  });
  actionsCell.append(toggle);
  row.append(actionsCell);
  return row;
}

function renderDevices() {
  const query = elements.search.value.trim().toLocaleLowerCase("pl");
  const filteredGroups = searchRelatedGroups(query).filter(matchesDeviceFilters);
  const pageCount = Math.max(1, Math.ceil(filteredGroups.length / pageSize));
  currentPage = Math.min(currentPage, pageCount);
  const start = (currentPage - 1) * pageSize;
  const pageGroups = filteredGroups.slice(start, start + pageSize);
  visiblePageDeviceIds = [...new Set(pageGroups.flatMap((group) =>
    group.devices.map((device) => device.id),
  ))];
  elements.pingVisibleDevices.disabled = visiblePageDeviceIds.length === 0;
  elements.pingVisibleDevices.textContent = visiblePageDeviceIds.length
    ? `Pinguj widoczne (${visiblePageDeviceIds.length})`
    : "Pinguj widoczne";

  elements.deviceList.replaceChildren();
  for (const group of pageGroups) {
    if (group.devices.length > 1 && !query && (group.groupName || group.related)) {
      elements.deviceList.append(renderGroupSummaryRow(group));
      if (expandedGroups.has(group.key)) {
        for (const device of group.devices) {
          elements.deviceList.append(renderDeviceRow(device, true));
        }
      }
    } else if (group.devices.length > 1 && query) {
      for (const device of group.devices) {
        elements.deviceList.append(renderDeviceRow(device, true));
      }
    } else {
      elements.deviceList.append(renderDeviceRow(group.devices[0]));
    }
  }

  const hasFilters = Boolean(query || categoryFilter || locationFilter || statusFilter);
  renderSummary(filteredGroups.flatMap((group) => group.devices), hasFilters);
  document.getElementById("result-count").textContent =
    hasFilters ? `${filteredGroups.length} wyników` : "";
  const firstPosition = filteredGroups.length ? start + 1 : 0;
  const lastPosition = Math.min(start + pageGroups.length, filteredGroups.length);
  document.getElementById("inventory-count").textContent =
    `Wyświetlono ${firstPosition}–${lastPosition} z ${filteredGroups.length} pozycji · ${devices.length} maszyn`;
  elements.pageIndicator.textContent = `Strona ${currentPage} z ${pageCount}`;
  elements.previousPage.disabled = currentPage === 1;
  elements.nextPage.disabled = currentPage === pageCount;
  elements.emptyState.classList.toggle("d-none", filteredGroups.length > 0);
  document.querySelector(".inventory-table").classList.toggle("d-none", filteredGroups.length === 0);
  document.getElementById("empty-title").textContent = devices.length ? "Brak wyników" : "Brak maszyn";
  document.getElementById("empty-description").textContent = devices.length
    ? "Zmień wyszukiwanie lub filtry i spróbuj ponownie."
    : "Dodaj pierwszą maszynę, aby rozpocząć tworzenie ewidencji.";
  document.getElementById("empty-add-device").classList.toggle("d-none", devices.length > 0);
}

function updateVisibleDeviceStatuses() {
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  for (const row of elements.deviceList.rows) {
    const relatedDevices = row.dataset.deviceIds
      .split(",")
      .map(Number)
      .map((id) => devicesById.get(id))
      .filter(Boolean);
    if (!relatedDevices.length) continue;

    const representative = relatedDevices[0];
    const subjectLabel = row.dataset.subjectLabel;
    const summary = statusSummary(relatedDevices);
    const status = row.querySelector(".status-trigger");
    status.classList.remove("status-online", "status-offline", "status-unknown");
    status.classList.add(`status-${summary.status}`);
    status.textContent = summary.label;
    status.title = relatedDevices.length > 1
      ? `Kliknij, aby sprawdzić ping dla ${subjectLabel} i jego zależności.`
      : representative.statusMessage || "Kliknij, aby sprawdzić ping i zależności.";
    status.setAttribute(
      "aria-label",
      `Status ${subjectLabel}: ${summary.label}. Kliknij, aby sprawdzić.`,
    );

    const latestCheck = relatedDevices
      .map((device) => device.statusCheckedAt)
      .filter(Boolean)
      .sort()
      .pop();
    let checkedAt = row.querySelector(".status-time");
    if (latestCheck) {
      if (!checkedAt) {
        checkedAt = document.createElement("small");
        checkedAt.className = "status-time";
        status.parentElement.append(checkedAt);
      }
      checkedAt.textContent = new Date(latestCheck).toLocaleString("pl-PL");
    } else {
      if (checkedAt) checkedAt.textContent = "\u00a0";
    }
  }

  const query = elements.search.value.trim().toLocaleLowerCase("pl");
  const filteredGroups = searchRelatedGroups(query).filter(matchesDeviceFilters);
  const hasFilters = Boolean(query || categoryFilter || locationFilter || statusFilter);
  renderSummary(filteredGroups.flatMap((group) => group.devices), hasFilters);
}

function monitorToggle(device, property, label, disabled = false) {
  const wrapper = document.createElement("label");
  wrapper.className = "monitor-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(device[property]);
  input.disabled = disabled || pendingMonitorUpdates.has(device.id);
  input.setAttribute("aria-label", `${label}: ${device.hostName}`);
  input.addEventListener("change", () => {
    saveMonitorSettings(device, {
      enabled: Boolean(device.monitorEnabled),
      notifyOnline: Boolean(device.notifyOnline),
      notifyOffline: Boolean(device.notifyOffline),
      [property]: input.checked,
    });
  });
  const text = document.createElement("span");
  text.textContent = label;
  wrapper.append(input, text);
  return wrapper;
}

function updateMonitorStatus(row, device) {
  const status = row.querySelector(".monitor-status");
  const label = {online: "Online", offline: "Brak odpowiedzi", unknown: "Nieustalony"}[device.status] || "Nieustalony";
  const className = `status-badge monitor-status status-${device.status}`;
  if (status.className !== className) status.className = className;
  if (status.textContent !== label) status.textContent = label;
  const time = row.querySelector(".status-time");
  const timeText = device.statusCheckedAt ? new Date(device.statusCheckedAt).toLocaleTimeString("pl-PL") : "\u00a0";
  if (time.textContent !== timeText) time.textContent = timeText;
  const latency = row.querySelector(".monitor-latency-value");
  const latencyText = device.status === "online" && Number.isFinite(device.pingLatencyMs)
    ? `${device.pingLatencyMs < 1 ? "<1" : Number(device.pingLatencyMs.toFixed(1))} ms` : "—";
  if (latency.textContent !== latencyText) latency.textContent = latencyText;
  const latencyClass = device.status === "online" ? "monitor-latency-value monitor-latency-online" : "monitor-latency-value";
  if (latency.className !== latencyClass) latency.className = latencyClass;
}

function renderMonitor() {
  const monitoredDevices = devices.filter((device) => device.monitorEnabled);
  const onlineCount = monitoredDevices.filter((device) => device.status === "online").length;
  const offlineCount = monitoredDevices.filter((device) => device.status === "offline").length;
  elements.monitorCount.textContent =
    `${monitoredDevices.length} aktywnych · ${onlineCount} online · ${offlineCount} bez odpowiedzi`;
  const previousRows = new Map([...elements.monitorList.rows].map(row => [row.dataset.deviceId, row]));
  const desiredRows = [];

  if (!monitoredDevices.length) {
    if (elements.monitorList.querySelector(".monitor-empty-cell")) return;
    elements.monitorList.replaceChildren();
    const row = document.createElement("tr");
    const empty = makeCell(
      "Brak aktywnych maszyn. Włącz monitorowanie przy wybranych maszynach w zakładce Maszyny.",
      "monitor-empty-cell",
    );
    empty.colSpan = 6;
    row.append(empty);
    elements.monitorList.append(row);
    return;
  }

  const statusLabels = {
    online: "Online",
    offline: "Brak odpowiedzi",
    unknown: "Nieustalony",
  };
  for (const device of monitoredDevices) {
    const metadata = JSON.stringify([device.id, device.hostName, device.ip, device.category,
      device.groupName, device.location, device.notifyOnline, device.notifyOffline,
      pendingMonitorUpdates.has(device.id)]);
    const existing = previousRows.get(String(device.id));
    if (existing && existing.dataset.metadata === metadata) {
      updateMonitorStatus(existing, device);
      desiredRows.push(existing);
      continue;
    }
    const row = document.createElement("tr");
    row.dataset.deviceId = String(device.id);
    row.dataset.metadata = metadata;
    const host = document.createElement("td");
    host.className = "host-cell";
    const hostName = document.createElement("button");
    hostName.type = "button";
    hostName.className = "monitor-host-name host-detail-trigger";
    hostName.textContent = device.hostName;
    hostName.prepend(categoryIcon(device.category));
    hostName.addEventListener("click", () => openDeviceDetails(devices.find(item => item.id === device.id) || device));
    const details = document.createElement("small");
    details.className = "monitor-device-meta";
    details.textContent = [device.groupName || device.category, device.location]
      .filter(Boolean)
      .join(" · ");
    host.append(hostName, details);
    row.append(host, makeCell(device.ip, "ip-cell"));

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `status-badge monitor-status status-${device.status}`;
    status.textContent = statusLabels[device.status] || statusLabels.unknown;
    statusCell.append(status);
    const checkedAt = document.createElement("small");
    checkedAt.className = "status-time";
    checkedAt.textContent = device.statusCheckedAt ? new Date(device.statusCheckedAt).toLocaleTimeString("pl-PL") : "\u00a0";
    statusCell.append(checkedAt);
    row.append(statusCell);

    const latency = device.status === "online" && Number.isFinite(device.pingLatencyMs)
      ? `${device.pingLatencyMs < 1 ? "<1" : Number(device.pingLatencyMs.toFixed(1))} ms`
      : "—";
    const latencyCell = document.createElement("td");
    latencyCell.className = "monitor-latency";
    const latencyValue = document.createElement("span");
    latencyValue.className = device.status === "online"
      ? "monitor-latency-value monitor-latency-online"
      : "monitor-latency-value";
    latencyValue.textContent = latency;
    latencyCell.append(latencyValue);
    row.append(latencyCell);
    const monitorCell = document.createElement("td");
    const disableMonitor = document.createElement("button");
    disableMonitor.className = "btn btn-sm btn-outline-secondary monitor-remove";
    disableMonitor.type = "button";
    disableMonitor.disabled = pendingMonitorUpdates.has(device.id);
    disableMonitor.textContent = "Wyłącz";
    disableMonitor.setAttribute("aria-label", `Wyłącz monitor: ${device.hostName}`);
    disableMonitor.addEventListener("click", () => saveMonitorSettings(device, {
      enabled: false,
      notifyOnline: Boolean(device.notifyOnline),
      notifyOffline: Boolean(device.notifyOffline),
    }));
    monitorCell.append(disableMonitor);
    row.append(monitorCell);

    const notifications = document.createElement("td");
    notifications.className = "monitor-notifications";
    notifications.append(
      monitorToggle(device, "notifyOnline", "Online", !device.monitorEnabled),
      monitorToggle(device, "notifyOffline", "Offline", !device.monitorEnabled),
    );
    row.append(notifications);
    desiredRows.push(row);
  }
  const keep = new Set(desiredRows);
  for (const row of [...elements.monitorList.rows]) if (!keep.has(row)) row.remove();
  desiredRows.forEach((row, index) => {
    if (elements.monitorList.rows[index] !== row) elements.monitorList.insertBefore(row, elements.monitorList.rows[index] || null);
  });
}

function notifyMonitorTransition(device, status) {
  const label = status === "online" ? "online" : "brak odpowiedzi";
  const message = `${device.hostName}: maszyna jest teraz ${label}.`;
  notify(message, status === "online" ? "success" : "danger");
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Lanwatch — zmiana statusu", { body: message });
    } catch (error) {
      console.error("Nie udało się wyświetlić powiadomienia systemowego:", error);
    }
  }
}

function trackMonitorStatusChanges(nextDevices) {
  for (const device of nextDevices) {
    const previousStatus = knownMonitorStatuses.get(device.id);
    if (
      hasLoadedMonitorStatuses &&
      device.monitorEnabled &&
      previousStatus !== device.status &&
      (device.status === "online" || device.status === "offline") &&
      (device.status === "online" ? device.notifyOnline : device.notifyOffline)
    ) {
      notifyMonitorTransition(device, device.status);
    }
    if (device.status === "online" || device.status === "offline" || previousStatus === undefined) {
      knownMonitorStatuses.set(device.id, device.status);
    }
  }
  const deviceIds = new Set(nextDevices.map((device) => device.id));
  for (const deviceId of knownMonitorStatuses.keys()) {
    if (!deviceIds.has(deviceId)) knownMonitorStatuses.delete(deviceId);
  }
  hasLoadedMonitorStatuses = true;
}

function inventoryMetadataChanged(nextDevices) {
  if (nextDevices.length !== devices.length) return true;
  const currentDevices = new Map(devices.map((device) => [device.id, device]));
  const metadata = (item) => JSON.stringify([
    item.hostName,
    item.ip,
    item.groupName,
    item.location,
    item.categoryId,
    item.category,
    item.lineNumber,
    item.numerator,
    item.description,
    item.dependencyIds,
    item.monitorEnabled,
    item.notifyOnline,
    item.notifyOffline,
  ]);
  return nextDevices.some((device) => {
    const current = currentDevices.get(device.id);
    if (!current) return true;
    return metadata(device) !== metadata(current);
  });
}

async function refresh({ preserveInventory = false } = {}) {
  const version = ++refreshVersion;
  const loadMetadata = !preserveInventory || Date.now() - metadataRefreshedAt >= 60000;
  const waitingTimer = window.setTimeout(() => {
    if (version === refreshVersion) setConnectionState("waiting");
  }, 2000);
  try {
    const [nextDevices, nextCategories, nextLocations, summary, settings] = await Promise.all([
      api("/api/devices"),
      loadMetadata ? api("/api/categories") : categories,
      loadMetadata ? api("/api/locations") : locations,
      loadMetadata ? api("/api/summary") : {onlineTtlMs},
      loadMetadata ? api("/api/settings") : {sshUser},
    ]);
    if (version !== refreshVersion) return;
    const canPreserveInventory = preserveInventory && !statusFilter && !inventoryMetadataChanged(nextDevices);
    trackMonitorStatusChanges(nextDevices);
    devices = nextDevices;
    if (loadMetadata) {
      categories = nextCategories;
      locations = nextLocations;
      sshUser = settings.sshUser;
      onlineTtlMs = summary.onlineTtlMs;
      metadataRefreshedAt = Date.now();
      renderSettings();
    }
    if (canPreserveInventory) updateVisibleDeviceStatuses();
    else renderDevices();
    renderMonitor();
    scheduleStatusExpiry(onlineTtlMs);
    if (elements.deviceDialog.open) updateDeviceIdentifierValidation();
    lastSuccessfulRefresh = new Date();
    setConnectionState("connected");
  } catch (error) {
    if (version === refreshVersion) setConnectionState("disconnected");
    throw error;
  } finally { window.clearTimeout(waitingTimer); }
}

async function saveMonitorSettings(device, settings) {
  if (pendingMonitorUpdates.has(device.id)) return;
  pendingMonitorUpdates.add(device.id);
  renderMonitor();
  try {
    if (
      (settings.notifyOnline || settings.notifyOffline) &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      try {
        // A browser permission prompt can remain unanswered indefinitely.
        // Saving monitor settings must not wait for that prompt.
        Promise.resolve(Notification.requestPermission()).catch((error) => {
          console.error("Nie udało się poprosić o uprawnienie do powiadomień:", error);
        });
      } catch (error) {
        console.error("Nie udało się poprosić o uprawnienie do powiadomień:", error);
      }
    }
    await api(`/api/devices/${device.id}/monitor`, {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    await refresh();
    notify("Ustawienia monitorowania zostały zapisane.");
  } catch (error) {
    notify(error.message, "danger");
    try {
      await refresh();
    } catch (refreshError) {
      notify(`Nie udało się odświeżyć ustawień: ${refreshError.message}`, "danger");
    }
  } finally {
    pendingMonitorUpdates.delete(device.id);
    renderMonitor();
  }
}

function scheduleLiveRefresh() {
  window.setTimeout(async () => {
    try {
      await refresh({ preserveInventory: true });
    } catch (error) {
      notify(error.message, "danger");
    } finally {
      scheduleLiveRefresh();
    }
  }, 5000);
}

function openDeviceForm(device = null) {
  if (elements.saveDevice.disabled) return;
  elements.deviceForm.reset();
  document.getElementById("device-save-error").hidden = true;
  document.getElementById("save-and-add-next").classList.toggle("d-none", Boolean(device));
  document.getElementById("device-id").value = device?.id || "";
  document.getElementById("device-dialog-title").textContent =
    device ? "Edytuj maszynę" : "Dodaj maszynę";
  elements.dependencyCreateField.classList.toggle("d-none", Boolean(device));
  elements.deviceHostName.value = device?.hostName || "";
  elements.deviceIp.value = device?.ip || "";
  document.getElementById("group-name").value = device?.groupName || "";
  elements.locations.value = device?.location || (locations.length === 1 ? locations[0].name : "");
  document.getElementById("line-number").value = device?.lineNumber || "";
  document.getElementById("numerator").value = device?.numerator || "";
  document.getElementById("device-description").value = device?.description || "";
  elements.categories.value = device?.categoryId || categories[0]?.id || "";
  updateDeviceIdentifierValidation();
  renderDependencies(device?.dependencyIds || [], device?.id || null);
  elements.deviceDialog.showModal();
  elements.deviceHostName.focus();
}

function startNamedItemEdit(type, item) {
  const config = namedItemConfig[type];
  editingIds[type] = item.id;
  config.input.value = item.name;
  config.saveButton.textContent = "Zapisz";
  config.cancelButton.classList.remove("d-none");
  config.input.focus();
}

function resetNamedItemEdit(type) {
  const config = namedItemConfig[type];
  editingIds[type] = null;
  config.form.reset();
  config.saveButton.textContent = "Dodaj";
  config.cancelButton.classList.add("d-none");
}

async function saveNamedItem(type, event) {
  event.preventDefault();
  const config = namedItemConfig[type];
  const id = editingIds[type];
  const isEditing = id !== null;
  if (config.saveButton.disabled) return;
  config.saveButton.disabled = true;
  try {
    await api(
      isEditing ? `/api/${config.endpoint}/${id}` : `/api/${config.endpoint}`,
      {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify({ name: config.input.value.trim() }),
      },
    );
    resetNamedItemEdit(type);
    await refresh();
    notify(isEditing
      ? `${config.labelCapitalized} została zaktualizowana.`
      : `${config.labelCapitalized} została dodana.`);
  } catch (error) {
    notify(error.message, "danger");
  } finally {
    config.saveButton.disabled = false;
  }
}

async function removeNamedItem(type, item) {
  const config = namedItemConfig[type];
  if (!window.confirm(`Czy na pewno usunąć ${config.label} „${item.name}”?`)) return;
  try {
    await api(`/api/${config.endpoint}/${item.id}`, { method: "DELETE" });
    if (editingIds[type] === item.id) resetNamedItemEdit(type);
    await refresh();
    notify(`${config.labelCapitalized} została usunięta.`);
  } catch (error) {
    notify(error.message, "danger");
  }
}

async function removeDevice(device) {
  if (!window.confirm(`Czy na pewno usunąć maszynę „${device.hostName}”?`)) return;
  try {
    await api(`/api/devices/${device.id}`, { method: "DELETE" });
    await refresh();
    notify("Maszyna została usunięta.");
  } catch (error) {
    notify(error.message, "danger");
  }
}

async function saveSshSettings(event) {
  event.preventDefault();
  try {
    const settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ sshUser: elements.sshUser.value.trim() }),
    });
    sshUser = settings.sshUser;
    elements.sshUser.value = sshUser;
    sshSettingsDirty = false;
    notify("Ustawienia SSH zostały zapisane.");
  } catch (error) {
    notify(error.message, "danger");
  }
}

async function openTunnelInPowerShell(device, button) {
  button.disabled = true;
  try {
    await api(
      `/api/devices/${device.id}/terminal/tunnel`,
      { method: "POST" },
    );
    notify(`Uruchomiono tunel dla ${device.hostName} w oknie PowerShell.`);
  } catch (error) {
    notify(error.message, "danger");
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function pingRequestTimeout() {
  // Include queued monitoring and all potential group members/dependencies.
  return 30000 + Math.ceil(devices.length / 8) * 12000;
}

async function pingDevice(device, button) {
  button.disabled = true;
  try {
    await api(`/api/devices/${device.id}/ping`, { method: "POST", timeoutMs: pingRequestTimeout() });
    await refresh({ preserveInventory: true });
  } catch (error) {
    notify(error.message, "danger");
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function pingVisibleDevices(button) {
  const deviceIds = [...visiblePageDeviceIds];
  if (!deviceIds.length) return;
  button.disabled = true;
  try {
    await api("/api/ping", {
      method: "POST",
      body: JSON.stringify({ deviceIds }),
      timeoutMs: pingRequestTimeout(),
    });
    await refresh({ preserveInventory: true });
  } catch (error) {
    notify(error.message, "danger");
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

document.getElementById("theme-toggle").addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

document.querySelectorAll(".main-nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".main-nav-button").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });
    document.querySelectorAll(".view-panel").forEach((view) => {
      view.classList.toggle("d-none", view.id !== button.dataset.view);
    });
  });
});

document.getElementById("add-device").addEventListener("click", () => openDeviceForm());
document.getElementById("empty-add-device").addEventListener("click", () => openDeviceForm());
elements.deviceHostName.addEventListener("input", updateDeviceIdentifierValidation);
elements.deviceIp.addEventListener("input", updateDeviceIdentifierValidation);
elements.sshSettingsForm.addEventListener("submit", saveSshSettings);
elements.sshUser.addEventListener("input", () => { sshSettingsDirty = true; });
elements.search.addEventListener("input", () => {
  currentPage = 1;
  renderDevices();
});
elements.pingVisibleDevices.addEventListener("click", () => {
  pingVisibleDevices(elements.pingVisibleDevices);
});
elements.filterCategory.addEventListener("change", () => {
  categoryFilter = elements.filterCategory.value;
  currentPage = 1;
  renderDevices();
});
elements.filterLocation.addEventListener("change", () => {
  locationFilter = elements.filterLocation.value;
  currentPage = 1;
  renderDevices();
});
elements.filterStatus.addEventListener("change", () => {
  statusFilter = elements.filterStatus.value;
  currentPage = 1;
  renderDevices();
});
elements.previousPage.addEventListener("click", () => {
  currentPage = Math.max(1, currentPage - 1);
  renderDevices();
});
elements.nextPage.addEventListener("click", () => {
  currentPage += 1;
  renderDevices();
});
elements.pageSize.addEventListener("change", () => {
  const selectedSize = Number(elements.pageSize.value);
  if (!allowedPageSizes.includes(selectedSize)) {
    notify("Nieprawidłowa liczba pozycji na stronie.", "danger");
    elements.pageSize.value = String(pageSize);
    return;
  }
  pageSize = selectedSize;
  currentPage = 1;
  savePreference("lanwatch-page-size", String(pageSize));
  renderDevices();
});
elements.dependencySearch.addEventListener("input", renderDependencyOptions);
elements.dependencyManagerSearch.addEventListener("input", renderDependencyManager);
elements.saveDependencies.addEventListener("click", saveDeviceDependencies);
elements.categoryForm.addEventListener("submit", (event) => saveNamedItem("category", event));
elements.locationForm.addEventListener("submit", (event) => saveNamedItem("location", event));
namedItemConfig.category.cancelButton.addEventListener("click", () => resetNamedItemEdit("category"));
namedItemConfig.location.cancelButton.addEventListener("click", () => resetNamedItemEdit("location"));

async function saveDevice(event) {
  event.preventDefault();
  if (elements.saveDevice.disabled) return;
  updateDeviceIdentifierValidation();
  if (!elements.deviceForm.reportValidity()) {
    notify("Sprawdź wymagane pola i popraw wskazane wartości.", "warning");
    return;
  }
  const id = document.getElementById("device-id").value;
  const addNext = event.type === "submit" &&
    event.submitter?.id === "save-and-add-next" &&
    !id;
  const formData = new FormData(elements.deviceForm);
  const device = Object.fromEntries(formData.entries());
  if (!id) device.dependencyIds = Array.from(selectedDependencyIds);
  const nextDefaults = {
    groupName: device.groupName,
    location: device.location,
    categoryId: device.categoryId,
  };
  const errorMessage = document.getElementById("device-save-error");
  errorMessage.hidden = true;
  elements.saveDevice.disabled = true;
  elements.saveDevice.textContent = "Zapisywanie…";
  document.getElementById("save-and-add-next").disabled = true;
  try {
    await api(id ? `/api/devices/${id}` : "/api/devices", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(device),
    });
    // The write has completed; a failed list refresh must not look like a failed write.
    if (!addNext) elements.deviceDialog.close();
    try {
      await refresh();
    } catch (error) {
      const warning = `Maszyna została zapisana, ale nie udało się odświeżyć listy. ${error.message}`;
      if (addNext) {
        elements.deviceDialog.close();
      }
      notify(warning, "warning");
      return;
    }
    if (addNext) {
      elements.deviceForm.reset();
      document.getElementById("group-name").value = nextDefaults.groupName;
      elements.locations.value = nextDefaults.location;
      elements.categories.value = nextDefaults.categoryId;
      updateDeviceIdentifierValidation();
      renderDependencies();
      elements.deviceHostName.focus();
      notify("Maszyna została dodana. Możesz wprowadzić następny element.");
    } else {
      elements.deviceDialog.close();
      notify(id ? "Zmiany maszyny zostały zapisane." : "Maszyna została dodana.");
    }
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
    errorMessage.scrollIntoView({ block: "nearest" });
  } finally {
    elements.saveDevice.disabled = false;
    elements.saveDevice.textContent = "Zapisz maszynę";
    document.getElementById("save-and-add-next").disabled = false;
  }
}

elements.deviceForm.addEventListener("submit", saveDevice);

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    document.getElementById(button.dataset.close).close();
  });
});

setTheme(readPreference("lanwatch-theme") || "light");
refresh()
  .then(scheduleLiveRefresh)
  .catch((error) => {
    notify(error.message, "danger");
    scheduleLiveRefresh();
  });

