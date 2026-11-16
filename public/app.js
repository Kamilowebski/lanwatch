const elements = {
  categories: document.getElementById("device-category"),
  categoryForm: document.getElementById("category-form"),
  categoryList: document.getElementById("category-list"),
  categoryName: document.getElementById("category-name"),
  dependencyCount: document.getElementById("dependency-count"),
  dependencyOptions: document.getElementById("dependency-options"),
  dependencySearch: document.getElementById("dependency-search"),
  deviceIp: document.getElementById("device-ip"),
  deviceHostName: document.getElementById("host-name"),
  deviceDialog: document.getElementById("device-dialog"),
  deviceForm: document.getElementById("device-form"),
  deviceList: document.getElementById("device-list"),
  deviceIpFeedback: document.getElementById("device-ip-feedback"),
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
  pingResultsDialog: document.getElementById("ping-results-dialog"),
  pingResultsList: document.getElementById("ping-results-list"),
  pingVisibleDevices: document.getElementById("ping-visible-devices"),
  pageIndicator: document.getElementById("page-indicator"),
  pageSize: document.getElementById("page-size-setting"),
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
const editingIds = { category: null, location: null };
const allowedPageSizes = [10, 20, 50, 100];
const savedPageSize = Number(localStorage.getItem("lanwatch-page-size"));
let pageSize = allowedPageSizes.includes(savedPageSize) ? savedPageSize : 20;
let currentPage = 1;
let categoryFilter = "";
let locationFilter = "";
let statusFilter = "";
let dependencyCurrentDeviceId = null;
let selectedDependencyIds = new Set();
let statusExpiryTimer = null;
const expandedGroups = new Set();
const knownMonitorStatuses = new Map();
let hasLoadedMonitorStatuses = false;
let visiblePageDeviceIds = [];

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || "Nie udało się wykonać operacji.");
  return result;
}

function notify(message, type = "success") {
  const alert = document.createElement("div");
  alert.className = `alert alert-${type} notification`;
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  elements.notifications.append(alert);
  window.setTimeout(() => alert.remove(), 4500);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("lanwatch-theme", theme);
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
  if (document.activeElement !== elements.sshUser) elements.sshUser.value = sshUser;
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
  }, Math.max(0, nextExpiry - Date.now() + 50));
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
  if (latestCheck) {
    const checkedAt = document.createElement("small");
    checkedAt.className = "status-time";
    checkedAt.textContent = new Date(latestCheck).toLocaleString("pl-PL");
    cell.append(checkedAt);
  }
  row.append(cell);
}

function renderDeviceRow(device, isGroupMember = false) {
  const row = document.createElement("tr");
  if (isGroupMember) row.className = "group-member-row";
  const hostCell = document.createElement("td");
  hostCell.className = "host-cell";
  const hostName = document.createElement("span");
  hostName.textContent = device.hostName;
  hostCell.append(hostName);
  if (device.groupName && !isGroupMember) {
    const groupName = document.createElement("small");
    groupName.className = "group-name-cell";
    groupName.textContent = device.groupName;
    hostCell.append(groupName);
  }
  row.append(hostCell, makeCell(device.ip, "ip-cell"), makeCell(device.location));

  const categoryCell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = "category-badge";
  badge.textContent = device.category;
  categoryCell.append(badge);
  row.append(categoryCell);
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
  const remove = document.createElement("button");
  remove.className = "row-action row-action-danger";
  remove.type = "button";
  remove.textContent = "Usuń";
  remove.addEventListener("click", () => removeDevice(device));
  actionsCell.append(edit, remove);
  row.append(actionsCell);
  return row;
}

function renderGroupSummaryRow(group) {
  const row = document.createElement("tr");
  const hostCell = document.createElement("td");
  hostCell.className = "host-cell group-summary-cell";
  const name = document.createElement("span");
  name.textContent = group.relatedName || group.groupName;
  const count = document.createElement("small");
  count.className = "group-name-cell";
  count.textContent = group.related
    ? `Połączone zależności: ${group.devices.length} maszyn`
    : `Liczba urządzeń: ${group.devices.length}`;
  hostCell.append(name, count);
  row.append(hostCell);
  row.append(makeCell(summaryValues(group.devices, "ip", "bez IP"), "ip-cell"));
  row.append(makeCell(summaryValues(group.devices, "location")));

  const categoryCell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = "category-badge";
  badge.textContent = summaryValues(group.devices, "category");
  categoryCell.append(badge);
  row.append(categoryCell);
  appendStatusCell(row, group.devices, group.devices[0], group.groupName);

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

function monitorToggle(device, property, label, disabled = false) {
  const wrapper = document.createElement("label");
  wrapper.className = "monitor-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(device[property]);
  input.disabled = disabled;
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

function renderMonitor() {
  const monitoredDevices = devices.filter((device) => device.monitorEnabled);
  const onlineCount = monitoredDevices.filter((device) => device.status === "online").length;
  const offlineCount = monitoredDevices.filter((device) => device.status === "offline").length;
  elements.monitorCount.textContent =
    `${monitoredDevices.length} aktywnych · ${onlineCount} online · ${offlineCount} bez odpowiedzi`;
  elements.monitorList.replaceChildren();

  if (!monitoredDevices.length) {
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
    const row = document.createElement("tr");
    const host = document.createElement("td");
    host.className = "host-cell";
    const hostName = document.createElement("span");
    hostName.className = "monitor-host-name";
    hostName.textContent = device.hostName;
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
    if (device.statusCheckedAt) {
      const checkedAt = document.createElement("small");
      checkedAt.className = "status-time";
      checkedAt.textContent = new Date(device.statusCheckedAt).toLocaleTimeString("pl-PL");
      statusCell.append(checkedAt);
    }
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
    elements.monitorList.append(row);
  }
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

async function refresh() {
  const [nextDevices, nextCategories, nextLocations, summary, settings] = await Promise.all([
    api("/api/devices"),
    api("/api/categories"),
    api("/api/locations"),
    api("/api/summary"),
    api("/api/settings"),
  ]);
  trackMonitorStatusChanges(nextDevices);
  devices = nextDevices;
  categories = nextCategories;
  locations = nextLocations;
  sshUser = settings.sshUser;
  renderSettings();
  renderDevices();
  renderMonitor();
  scheduleStatusExpiry(summary.onlineTtlMs);
  if (elements.deviceDialog.open) updateDeviceIdentifierValidation();
}

async function saveMonitorSettings(device, settings) {
  try {
    let notificationPermissionFailed = false;
    if (
      (settings.notifyOnline || settings.notifyOffline) &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      try {
        await Notification.requestPermission();
      } catch (error) {
        notificationPermissionFailed = true;
        console.error("Nie udało się poprosić o uprawnienie do powiadomień:", error);
      }
    }
    await api(`/api/devices/${device.id}/monitor`, {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    await refresh();
    notify(notificationPermissionFailed
      ? "Ustawienia zapisano, ale nie udało się poprosić o powiadomienia systemowe."
      : "Ustawienia monitorowania zostały zapisane.");
  } catch (error) {
    notify(error.message, "danger");
    try {
      await refresh();
    } catch (refreshError) {
      notify(`Nie udało się odświeżyć ustawień: ${refreshError.message}`, "danger");
    }
  }
}

function scheduleLiveRefresh() {
  window.setTimeout(async () => {
    try {
      await refresh();
    } catch (error) {
      notify(error.message, "danger");
    } finally {
      scheduleLiveRefresh();
    }
  }, 5000);
}

function openDeviceForm(device = null) {
  elements.deviceForm.reset();
  document.getElementById("save-and-add-next").classList.toggle("d-none", Boolean(device));
  document.getElementById("device-id").value = device?.id || "";
  document.getElementById("device-dialog-title").textContent =
    device ? "Edytuj maszynę" : "Dodaj maszynę";
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

function renderPingResults(results) {
  const statusLabels = {
    online: "Online",
    offline: "Brak odpowiedzi",
    unknown: "Nieustalony",
  };
  elements.pingResultsList.replaceChildren();
  for (const result of results) {
    const row = document.createElement("tr");
    const machine = document.createElement("td");
    machine.textContent = result.hostName;
    const target = document.createElement("td");
    target.textContent = result.target || "—";
    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `status-badge status-${result.status}`;
    status.textContent = statusLabels[result.status] || statusLabels.unknown;
    statusCell.append(status);
    if (result.message) {
      const message = document.createElement("small");
      message.className = "ping-message";
      message.textContent = result.message;
      statusCell.append(message);
    }
    const replies = document.createElement("td");
    replies.textContent = result.attempts
      ? `${result.replies}/${result.attempts}`
      : "Nie wysłano";
    row.append(machine, target, statusCell, replies);
    elements.pingResultsList.append(row);
  }
}

async function pingDevice(device, button) {
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Sprawdzam…";
  try {
    const { results } = await api(`/api/devices/${device.id}/ping`, { method: "POST" });
    await refresh();
    renderPingResults(results);
    elements.pingResultsDialog.showModal();
  } catch (error) {
    notify(error.message, "danger");
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }
}

async function pingVisibleDevices(button) {
  const deviceIds = [...visiblePageDeviceIds];
  if (!deviceIds.length) return;
  button.disabled = true;
  const previousLabel = button.textContent;
  button.textContent = "Sprawdzam…";
  try {
    const result = await api("/api/ping", {
      method: "POST",
      body: JSON.stringify({ deviceIds }),
    });
    await refresh();
    notify(`Sprawdzono ${result.checked} widocznych maszyn. Wyniki zapisano w tabeli.`);
  } catch (error) {
    notify(error.message, "danger");
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = previousLabel;
    }
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
  localStorage.setItem("lanwatch-page-size", String(pageSize));
  renderDevices();
});
elements.dependencySearch.addEventListener("input", renderDependencyOptions);
elements.categoryForm.addEventListener("submit", (event) => saveNamedItem("category", event));
elements.locationForm.addEventListener("submit", (event) => saveNamedItem("location", event));
namedItemConfig.category.cancelButton.addEventListener("click", () => resetNamedItemEdit("category"));
namedItemConfig.location.cancelButton.addEventListener("click", () => resetNamedItemEdit("location"));

elements.deviceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  updateDeviceIdentifierValidation();
  if (!elements.deviceForm.reportValidity()) return;
  const id = document.getElementById("device-id").value;
  const addNext = event.submitter?.id === "save-and-add-next" && !id;
  const formData = new FormData(elements.deviceForm);
  const device = Object.fromEntries(formData.entries());
  device.dependencyIds = Array.from(selectedDependencyIds);
  const nextDefaults = {
    groupName: device.groupName,
    location: device.location,
    categoryId: device.categoryId,
  };
  try {
    await api(id ? `/api/devices/${id}` : "/api/devices", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(device),
    });
    await refresh();
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
    notify(error.message, "danger");
  }
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    document.getElementById(button.dataset.close).close();
  });
});

setTheme(localStorage.getItem("lanwatch-theme") || "light");
refresh()
  .then(scheduleLiveRefresh)
  .catch((error) => {
    notify(error.message, "danger");
    scheduleLiveRefresh();
  });
