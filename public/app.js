const elements = {
  categories: document.getElementById("device-category"),
  categoryDialog: document.getElementById("category-dialog"),
  categoryForm: document.getElementById("category-form"),
  categoryList: document.getElementById("category-list"),
  categoryName: document.getElementById("category-name"),
  dependencies: document.getElementById("device-dependencies"),
  deviceDialog: document.getElementById("device-dialog"),
  deviceForm: document.getElementById("device-form"),
  deviceList: document.getElementById("device-list"),
  emptyState: document.getElementById("empty-state"),
  notifications: document.getElementById("notifications"),
  search: document.getElementById("device-search"),
};

let devices = [];
let categories = [];
let editingCategoryId = null;

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
  document.getElementById("summary-categories").textContent = summary.categories;
  document.getElementById("summary-locations").textContent = summary.locations;
}

function renderCategories() {
  elements.categories.replaceChildren();
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    elements.categories.append(option);
  }

  elements.categoryList.replaceChildren();
  for (const category of categories) {
    const row = document.createElement("div");
    row.className = "category-row";
    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = category.name;
    const actions = document.createElement("div");
    actions.className = "category-actions";
    const edit = document.createElement("button");
    edit.className = "btn btn-sm btn-outline-secondary";
    edit.type = "button";
    edit.textContent = "Edytuj";
    edit.addEventListener("click", () => startCategoryEdit(category));
    const remove = document.createElement("button");
    remove.className = "btn btn-sm btn-outline-danger";
    remove.type = "button";
    remove.textContent = "Usuń";
    remove.addEventListener("click", () => removeCategory(category));
    actions.append(edit, remove);
    row.append(name, actions);
    elements.categoryList.append(row);
  }
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
    option.textContent = `${device.hostName} · ${device.ip}`;
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
    const categoryCell = makeCell("");
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
  const [nextDevices, nextCategories, summary] = await Promise.all([
    api("/api/devices"),
    api("/api/categories"),
    api("/api/summary"),
  ]);
  devices = nextDevices;
  categories = nextCategories;
  renderCategories();
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
  document.getElementById("device-location").value = device?.location || "";
  document.getElementById("line-number").value = device?.lineNumber || "";
  document.getElementById("numerator").value = device?.numerator || "";
  document.getElementById("device-description").value = device?.description || "";
  if (device) elements.categories.value = device.categoryId;
  renderDependencies(device?.dependencyIds || [], device?.id || null);
  elements.deviceDialog.showModal();
  document.getElementById("host-name").focus();
}

function startCategoryEdit(category) {
  editingCategoryId = category.id;
  elements.categoryName.value = category.name;
  document.getElementById("save-category").textContent = "Zapisz";
  document.getElementById("cancel-category-edit").classList.remove("d-none");
  elements.categoryName.focus();
}

function resetCategoryEdit() {
  editingCategoryId = null;
  elements.categoryForm.reset();
  document.getElementById("save-category").textContent = "Dodaj";
  document.getElementById("cancel-category-edit").classList.add("d-none");
}

async function removeCategory(category) {
  if (!window.confirm(`Czy na pewno usunąć kategorię „${category.name}”?`)) return;
  try {
    await api(`/api/categories/${category.id}`, { method: "DELETE" });
    if (editingCategoryId === category.id) resetCategoryEdit();
    await refresh();
    notify("Kategoria została usunięta.");
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

document.getElementById("add-device").addEventListener("click", () => openDeviceForm());
document.getElementById("empty-add-device").addEventListener("click", () => openDeviceForm());
document.getElementById("manage-categories").addEventListener("click", () => {
  elements.categoryDialog.showModal();
});
elements.search.addEventListener("input", renderDevices);

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

elements.categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.categoryName.value.trim();
  const isEditing = editingCategoryId !== null;
  try {
    await api(
      editingCategoryId ? `/api/categories/${editingCategoryId}` : "/api/categories",
      {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify({ name }),
      },
    );
    resetCategoryEdit();
    await refresh();
    notify(isEditing ? "Kategoria została zaktualizowana." : "Kategoria została dodana.");
  } catch (error) {
    notify(error.message, "danger");
  }
});

document.getElementById("cancel-category-edit").addEventListener("click", resetCategoryEdit);
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    document.getElementById(button.dataset.close).close();
  });
});
elements.categoryDialog.addEventListener("close", resetCategoryEdit);

setTheme(localStorage.getItem("lanwatch-theme") || "light");
refresh().catch((error) => notify(error.message, "danger"));
