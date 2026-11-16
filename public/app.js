const elements = {
  categories: document.getElementById("device-category"),
  categoryForm: document.getElementById("category-form"),
  categoryList: document.getElementById("category-list"),
  categoryName: document.getElementById("category-name"),
  dependencies: document.getElementById("device-dependencies"),
  deviceDialog: document.getElementById("device-dialog"),
  deviceForm: document.getElementById("device-form"),
  deviceList: document.getElementById("device-list"),
  emptyState: document.getElementById("empty-state"),
  locationForm: document.getElementById("location-form"),
  locationList: document.getElementById("location-list"),
  locationName: document.getElementById("location-name"),
  locations: document.getElementById("device-location"),
  notifications: document.getElementById("notifications"),
  search: document.getElementById("device-search"),
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
const editingIds = { category: null, location: null };

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

function renderSummary(summary) {
  document.getElementById("summary-devices").textContent = summary.devices;
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
  renderSelect(
    elements.categories,
    categories.map((category) => ({ value: category.id, name: category.name })),
    "",
    "kategorię",
  );
  renderSelect(
    elements.locations,
    locations.map((location) => ({ value: location.name, name: location.name })),
    "",
    "lokalizację",
  );
  renderNamedItems("category", categories);
  renderNamedItems("location", locations);
}

function renderDependencies(selectedIds = [], currentDeviceId = null) {
  elements.dependencies.replaceChildren();
  const availableDevices = devices.filter((device) => device.id !== currentDeviceId);
  if (!availableDevices.length) {
    const option = document.createElement("option");
    option.disabled = true;
    option.textContent = "Najpierw dodaj inne maszyny";
    elements.dependencies.append(option);
    return;
  }
  for (const device of availableDevices) {
    const option = document.createElement("option");
    option.value = device.id;
    option.textContent = `${device.hostName} · ${device.ip || "bez IP"}`;
    option.selected = selectedIds.includes(device.id);
    elements.dependencies.append(option);
  }
}

function makeCell(text, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text || "—";
  return cell;
}

function renderDevices() {
  const query = elements.search.value.trim().toLocaleLowerCase("pl");
  const visibleDevices = devices.filter((device) =>
    [device.hostName, device.ip, device.location, device.category]
      .some((value) => value.toLocaleLowerCase("pl").includes(query)),
  );

  elements.deviceList.replaceChildren();
  for (const device of visibleDevices) {
    const row = document.createElement("tr");
    row.append(
      makeCell(device.hostName, "host-cell"),
      makeCell(device.ip, "ip-cell"),
      makeCell(device.location),
    );
    const categoryCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "category-badge";
    badge.textContent = device.category;
    categoryCell.append(badge);
    row.append(categoryCell);

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = "status-badge";
    status.textContent = "Nie sprawdzono";
    statusCell.append(status);
    row.append(statusCell);

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-cell";
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
    elements.deviceList.append(row);
  }

  document.getElementById("result-count").textContent =
    query ? `${visibleDevices.length} wyników` : "";
  document.getElementById("inventory-count").textContent =
    `Wyświetlono ${visibleDevices.length} z ${devices.length} maszyn`;
  elements.emptyState.classList.toggle("d-none", visibleDevices.length > 0);
  document.querySelector(".inventory-table").classList.toggle("d-none", visibleDevices.length === 0);
  document.getElementById("empty-title").textContent = devices.length ? "Brak wyników" : "Brak maszyn";
  document.getElementById("empty-description").textContent = devices.length
    ? "Zmień frazę wyszukiwania i spróbuj ponownie."
    : "Dodaj pierwszą maszynę, aby rozpocząć tworzenie ewidencji.";
  document.getElementById("empty-add-device").classList.toggle("d-none", devices.length > 0);
}

async function refresh() {
  const [nextDevices, nextCategories, nextLocations, summary] = await Promise.all([
    api("/api/devices"),
    api("/api/categories"),
    api("/api/locations"),
    api("/api/summary"),
  ]);
  devices = nextDevices;
  categories = nextCategories;
  locations = nextLocations;
  renderSettings();
  renderDevices();
  renderSummary(summary);
}

function openDeviceForm(device = null) {
  elements.deviceForm.reset();
  document.getElementById("device-id").value = device?.id || "";
  document.getElementById("device-dialog-title").textContent =
    device ? "Edytuj maszynę" : "Dodaj maszynę";
  document.getElementById("host-name").value = device?.hostName || "";
  document.getElementById("device-ip").value = device?.ip || "";
  elements.locations.value = device?.location || (locations.length === 1 ? locations[0].name : "");
  document.getElementById("line-number").value = device?.lineNumber || "";
  document.getElementById("numerator").value = device?.numerator || "";
  document.getElementById("device-description").value = device?.description || "";
  elements.categories.value = device?.categoryId || categories[0]?.id || "";
  renderDependencies(device?.dependencyIds || [], device?.id || null);
  elements.deviceDialog.showModal();
  document.getElementById("host-name").focus();
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
elements.search.addEventListener("input", renderDevices);
elements.categoryForm.addEventListener("submit", (event) => saveNamedItem("category", event));
elements.locationForm.addEventListener("submit", (event) => saveNamedItem("location", event));
namedItemConfig.category.cancelButton.addEventListener("click", () => resetNamedItemEdit("category"));
namedItemConfig.location.cancelButton.addEventListener("click", () => resetNamedItemEdit("location"));

elements.deviceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("device-id").value;
  const formData = new FormData(elements.deviceForm);
  const device = Object.fromEntries(formData.entries());
  device.dependencyIds = Array.from(elements.dependencies.selectedOptions)
    .filter((option) => !option.disabled)
    .map((option) => Number(option.value));
  try {
    await api(id ? `/api/devices/${id}` : "/api/devices", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(device),
    });
    elements.deviceDialog.close();
    await refresh();
    notify(id ? "Zmiany maszyny zostały zapisane." : "Maszyna została dodana.");
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
refresh().catch((error) => notify(error.message, "danger"));
