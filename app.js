const state = {
  bootstrap: null,
  page: "Dashboard",
  inventory: { items: [], locations: [] },
  archivedItems: [],
  inventorySection: "active",
  issueItems: [],
  dashboard: null,
  transactions: null,
  requests: null,
  water: null,
  admin: null,
  waterSection: "Overview",
  adminSection: "Users",
  report: null,
  reportSpec: null,
  itemDraft: null,
  openStore: "Dry Store",
  openRequestStore: "All Stock Requests",
  busy: false,
  movementFilters: null,
  auditor: null,
  theme: localStorage.getItem("capitol-theme") === "dark" ? "dark" : "light",
};

const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const WATER_EXEMPT = new Set([28, 29, 30, 31, 32, 36, 38, 39].map(room => `Room ${room}`));
const ACCENT_COLORS = {
  teal: ["#1a9b88", "#127d70"],
  blue: ["#3977d5", "#285bb0"],
  violet: ["#7857c5", "#5a3ea0"],
  orange: ["#d77b32", "#ae5d20"],
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function prettyDate(value) {
  if (!value) return "—";
  const date = String(value).slice(0, 10);
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function prettyDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return esc(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function number(value, digits = 3) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value || 0));
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function toast(message, error = false) {
  const element = document.createElement("div");
  element.className = `toast${error ? " error" : ""}`;
  element.setAttribute("role", error ? "alert" : "status");
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = error ? "!" : "✓";
  const content = document.createElement("span");
  content.className = "toast-message";
  const title = document.createElement("strong");
  title.textContent = error ? "Please check" : "Done";
  const detail = document.createElement("span");
  detail.textContent = message;
  content.append(title, detail);
  element.append(icon, content);
  toastRegion.append(element);
  window.setTimeout(() => element.remove(), 4800);
}

async function api(url, options = {}) {
  const method = options.method || "GET";
  const headers = { Accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method) && state.bootstrap?.csrfToken) {
    headers["X-CSRF-Token"] = state.bootstrap.csrfToken;
  }
  let response;
  try {
    response = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new Error(`The app server is unavailable. Check your internet connection and try again. ${error.message}`);
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(`The app server returned an invalid response (${response.status}). ${error.message}`);
  }
  if (!response.ok) {
    const failure = new Error(result.error || `Request failed (${response.status}).`);
    failure.status = response.status;
    failure.payload = result;
    throw failure;
  }
  return result;
}

function field(label, id, type = "text", options = {}) {
  const attrs = [
    options.required ? "required" : "",
    options.min !== undefined ? `min="${options.min}"` : "",
    options.step ? `step="${options.step}"` : "",
    options.maxlength ? `maxlength="${options.maxlength}"` : "",
    options.minlength ? `minlength="${options.minlength}"` : "",
    options.pattern ? `pattern="${options.pattern}"` : "",
    options.inputmode ? `inputmode="${options.inputmode}"` : "",
    options.placeholder ? `placeholder="${esc(options.placeholder)}"` : "",
    options.value !== undefined ? `value="${esc(options.value)}"` : "",
    options.autocomplete ? `autocomplete="${options.autocomplete}"` : "",
    options.readonly ? "readonly" : "",
  ].filter(Boolean).join(" ");
  if (options.select) {
    const choices = options.select.map(choice => {
      const value = typeof choice === "string" ? choice : choice.value;
      const text = typeof choice === "string" ? choice : choice.label;
      const selected = String(value) === String(options.value ?? options.defaultValue ?? "");
      return `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(text)}</option>`;
    }).join("");
    return `<label class="form-field"><span>${label}</span><select id="${id}" name="${esc(options.name || id)}" ${options.required ? "required" : ""}>${choices}</select></label>`;
  }
  return `<label class="form-field"><span>${label}</span><input id="${id}" name="${esc(options.name || id)}" type="${type}" ${attrs}/></label>`;
}

function passwordField(label, id, autocomplete = "new-password") {
  if (state.bootstrap?.passwordPolicy === "strong") {
    return field(label, id, "password", {
      required: true,
      minlength: 12,
      maxlength: 128,
      pattern: "(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,128}",
      autocomplete,
      placeholder: "12+ characters, upper/lowercase and a number",
    });
  }
  return field(label, id, "password", {
    required: true,
    minlength: 4,
    maxlength: 4,
    pattern: "[0-9]{4}",
    inputmode: "numeric",
    autocomplete,
    placeholder: "Four numbers",
  });
}

function passwordPolicyDescription() {
  return state.bootstrap?.passwordPolicy === "strong"
    ? "Use at least 12 characters with uppercase and lowercase letters and a number."
    : "Use exactly four numbers. Passwords are stored as salted, one-way hashes locally.";
}

function button(text, action, options = {}) {
  const classes = ["button", options.primary ? "primary" : "", options.danger ? "danger" : "", options.small ? "small" : ""].filter(Boolean).join(" ");
  return `<button type="${options.type || "button"}" class="${classes}" ${action ? `data-action="${action}"` : ""} ${options.disabled ? "disabled" : ""}>${text}</button>`;
}

function shell(content) {
  const user = state.bootstrap.user;
  const nav = [
    ["Dashboard", "⌂", "OVERVIEW"],
    ...(user.role === "auditor" ? [] : [["Stock issue", "↙", "STOCK"]]),
    ["Inventory", "▦", null],
    ["Requests", "▤", null],
    ["Stock movements", "◷", null],
    ["Water", "≈", "TRACKING"],
    ["Reports", "▤", null],
  ];
  if (user.role === "admin") nav.push(["Admin", "⚙", "ADMINISTRATION"]);
  if (user.role === "admin" || user.role === "auditor") nav.push(["Auditor", "◉", "REVIEW"]);
  let lastGroup = "";
  const navMarkup = nav.map(([name, icon, group]) => {
    const separator = group && group !== lastGroup ? `<p class="nav-caption">${group}</p>` : "";
    if (group) lastGroup = group;
    return `${separator}<button class="nav-item ${state.page === name ? "active" : ""}" data-page="${esc(name)}"><span>${icon}</span>${esc(name)}</button>`;
  }).join("");
  app.dataset.theme = state.theme;
  const appearance = state.bootstrap.appearance || { accent: "teal", textSize: "normal" };
  const [accent, accentDark] = ACCENT_COLORS[appearance.accent] || ACCENT_COLORS.teal;
  app.dataset.textSize = appearance.textSize === "large" ? "large" : "normal";
  app.dataset.fontFamily = appearance.fontFamily === "manrope" ? "manrope" : "inter";
  app.dataset.glass = appearance.style === "classic" ? "off" : "on";
  app.style.setProperty("--teal", accent);
  app.style.setProperty("--teal-dark", accentDark);
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar">
      <a href="#" class="brand" data-page="Dashboard"><span class="brand-mark"><img src="/assets/capitol-catering-icon.png" alt="Capitol Catering"></span><span><strong>CAPITOL</strong><small>STOCK MANAGEMENT</small></span></a>
      <div class="workspace-card"><span class="workspace-symbol">C</span><span><strong>Capitol Stores</strong><small>Local workspace</small></span><i class="online-dot"></i></div>
      <nav class="primary-nav" aria-label="Main navigation">${navMarkup}</nav>
      <div class="sidebar-callout"><span>✦</span><strong>Stock, clearly.</strong><p>Local inventory and water distribution in one place.</p></div>
      <div class="sidebar-bottom">
        <div class="user-card"><span class="user-avatar">${esc(user.displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase())}</span><span><strong>${esc(user.displayName)}</strong><small>${user.role === "admin" ? "Administrator" : user.role === "auditor" ? "Auditor · read only" : "Standard user"}</small></span></div>
        <div class="local-note"><i></i> DATA STAYS ON THIS PC</div>
      </div>
    </aside>
    <main class="main-shell">
      <header class="topbar"><div><div class="breadcrumb"><span>Capitol</span><span>/</span><strong>${esc(state.page)}</strong></div><p>Inventory, requisitions &amp; distribution</p></div><div class="topbar-right"><button type="button" class="theme-toggle" data-action="toggle-theme" aria-label="Switch to ${state.theme === "dark" ? "light" : "dark"} theme" title="Switch theme">${state.theme === "dark" ? "☀" : "☾"}</button><span class="today-chip"><i></i>${prettyDate(dateKey())}</span><span class="avatar" title="${esc(user.displayName)}">${esc(user.displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase())}</span><button type="button" class="topbar-logout" data-action="logout">Log out</button></div></header>
      <section id="page-content" class="page-content">${content}</section>
      <footer class="footer"><span><i></i> Private local workspace</span><span>CAPITOL STOCK MANAGEMENT</span></footer>
    </main>
  </div><div id="modal-root"></div>`;
}

function pageHeading(kicker, title, description, actions = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></div><div class="page-actions">${actions}</div></div>`;
}

function stat(label, value, caption, icon, tone = "") {
  return `<article class="card stat-card ${tone}"><div class="stat-top"><span>${label}</span><i>${icon}</i></div><strong>${value}</strong><small>${caption}</small></article>`;
}

function statusPill(status) {
  const style = status === "Low stock" || status === "Expired" ? "warning" :
    status === "Out of stock" ? "danger" : status === "In stock" ? "good" : "neutral";
  return `<span class="pill ${style}">${esc(status)}</span>`;
}

function renderDashboard(data) {
  state.dashboard = data;
  const firstName = state.bootstrap.user.displayName.split(" ")[0];
  const categories = data.categoryTotals || [];
  const max = Math.max(1, ...categories.map(row => Number(row.quantity)));
  const bars = categories.length
    ? categories.map(row => `<div class="category-row"><span>${esc(row.category)}</span><progress class="bar-track" value="${Number(row.quantity)}" max="${max}" aria-label="${esc(row.category)} stock quantity"></progress><strong>${number(row.quantity)}</strong></div>`).join("")
    : `<div class="empty-inline">Create a stock item to see category balances.</div>`;
  const recent = data.recent.length
    ? data.recent.map(row => `<div class="movement-row"><span class="movement-symbol ${row.quantity > 0 ? "in" : "out"}">${row.quantity > 0 ? "↓" : "↑"}</span><span class="movement-main"><strong>${esc(row.item_name)} <small>${esc(row.item_sku)}</small></strong><span>${esc(row.kind)} · ${esc(row.location_name)}</span></span><span class="movement-value ${row.quantity > 0 ? "positive" : "negative"}">${row.quantity > 0 ? "+" : ""}${number(row.quantity)} ${esc(row.unit)}</span></div>`).join("")
    : `<div class="empty-inline">No movements recorded yet.</div>`;
  const alerts = data.expiring.length
    ? data.expiring.slice(0, 6).map(batch => `<div class="alert-row"><span class="alert-icon">${batch.expired ? "!" : "◷"}</span><span><strong>${esc(batch.itemName)}</strong><small>${esc(batch.location)} · batch expires ${prettyDate(batch.expiryDate)}</small></span><strong>${number(batch.quantity)} ${esc(batch.unit)}</strong></div>`).join("")
    : `<div class="empty-inline">No stock is expired or due to expire in the next 30 days.</div>`;
  const action = state.bootstrap.user.role === "admin" ? button("＋ Add item", "new-item", { primary: true }) :
    state.bootstrap.user.role === "user" ? button("Create requisition →", "go-issue", { primary: true }) :
      `<button class="button primary" data-page="Auditor">Open auditor workspace →</button>`;
  return `${pageHeading("STORE OVERVIEW", `Good morning, ${esc(firstName)}`, "Here’s the stock and activity at your stores today.", action)}
    <section class="stat-grid">${stat("ACTIVE ITEMS", number(data.totalItems, 0), "Across all stock categories", "▦")}${stat("STOCK ON HAND", number(data.totalUnits), "Total quantity in item units", "◈", "mint")}${stat("LOW / OUT OF STOCK", `${data.lowStock} / ${data.outOfStock}`, "Items at or below reorder level", "!", "amber")}${stat("ISSUED TODAY", number(data.stockIssuedToday, 0), `${data.waterIssuedToday} water locations served`, "↗", "blue")}</section>
    <section class="dashboard-grid">
      <article class="card panel-card category-panel"><div class="panel-heading"><div><span class="section-label">INVENTORY MIX</span><h2>Stock by category</h2></div><button class="link-button" data-page="Inventory">View inventory →</button></div><div class="category-list">${bars}</div><div class="category-foot"><span>Items are totalled across active store locations.</span></div></article>
      <article class="card panel-card alert-panel"><div class="panel-heading"><div><span class="section-label">EXPIRY WATCH</span><h2>Expiry &amp; stock alerts</h2></div><span class="count-chip">${data.expiring.length} batches</span></div><div class="alert-list">${alerts}</div></article>
      <article class="card panel-card recent-panel"><div class="panel-heading"><div><span class="section-label">LATEST ACTIVITY</span><h2>Stock movements</h2></div><button class="link-button" data-page="Stock movements">All activity →</button></div><div class="movement-list">${recent}</div></article>
      <article class="card panel-card water-shortcut"><div class="water-art"><span>≈</span><i></i><i></i><i></i></div><span class="section-label">WATER DISTRIBUTION</span><h2>Water tracker</h2><p>See room cooldowns, issue water and generate water reports.</p><div class="water-summary"><span><strong>${data.waterIssuedToday}</strong><small>locations issued today</small></span><span><strong>46</strong><small>tracked recipients</small></span></div><button class="button secondary" data-page="Water">Open water tracker →</button></article>
    </section>`;
}

function locationOptions(selected = "") {
  return state.inventory.locations.map(location => `<option value="${esc(location.id)}" ${location.id === selected ? "selected" : ""}>${esc(location.name)}</option>`).join("");
}

function categoryForStore(store) {
  const categoryName = store.replace(/\s+Store$/i, "").trim().toLocaleLowerCase();
  return state.bootstrap.categories.find(category => category.trim().toLocaleLowerCase() === categoryName) || "";
}

function categoryOptions(selected = "") {
  return state.bootstrap.categories.map(category => `<option value="${esc(category)}" ${category === selected ? "selected" : ""}>${esc(category)}</option>`).join("");
}

function renderInventory(data) {
  const admin = state.bootstrap.user.role === "admin";
  const query = document.querySelector("#inventory-search")?.value || "";
  const category = document.querySelector("#inventory-category")?.value || "";
  if (admin && state.inventorySection === "archive") {
    const archived = (state.archivedItems || []).filter(item =>
      !query || `${item.name} ${item.sku}`.toLowerCase().includes(query.toLowerCase()),
    );
    const columns = data.inventoryColumns || state.bootstrap.inventoryColumns || [];
    const rows = archived.map(item => `<tr>
      <td><span class="sku">${esc(item.sku)}</span></td><td><strong>${esc(item.name)}</strong></td>
      <td>${esc(item.store)}</td><td>${esc(item.category)}</td><td>${number(item.on_hand)} ${esc(item.unit)}</td>
      <td>${prettyDate(item.updated_at)}</td>
      ${columns.map(column => `<td>${esc(item.custom_values?.[column.id] || "—")}</td>`).join("")}
      <td><button type="button" class="button small danger" data-action="permanently-delete-item" data-id="${esc(item.id)}">Delete permanently</button></td>
    </tr>`).join("");
    const archiveHeadings = `<tr><th>SKU</th><th>ITEM</th><th>STORE</th><th>CATEGORY</th><th>ON HAND</th><th>ARCHIVED / UPDATED</th>${columns.map(column => `<th>${esc(column.name)}</th>`).join("")}<th>ACTIONS</th></tr>`;
    const toolbar = `<div class="table-toolbar"><label class="search-input"><span>⌕</span><input id="inventory-search" placeholder="Search archived SKU or item name" value="${esc(query)}" /></label><span class="result-count">${archived.length} archived items</span></div>`;
    return `${pageHeading("ARCHIVED CATALOG ITEMS", "Inventory archive", "Archived items remain here until permanently deleted.", `<button type="button" class="button secondary" data-action="show-active-items">← Active inventory</button>`)}
      <section class="card inventory-card">${toolbar}<div class="table-scroll"><table class="data-table wide-table"><thead>${archiveHeadings}</thead><tbody>${rows || `<tr><td colspan="${7 + columns.length}"><div class="empty-state"><span>▦</span><strong>No archived items</strong><p>Items archived from active inventory will appear here.</p></div></td></tr>`}</tbody></table></div></section>`;
  }
  const items = data.items.filter(item => (!query || `${item.name} ${item.sku}`.toLowerCase().includes(query.toLowerCase())) && (!category || item.category === category));
  const stores = state.bootstrap.stores || [];
  const columns = data.inventoryColumns || state.bootstrap.inventoryColumns || [];
  if (state.openStore && !stores.includes(state.openStore)) state.openStore = stores[0] || "";
  const addButton = admin ? button("＋ New item", "new-item", { primary: true }) : "";
  const headings = `<tr><th>SKU</th><th>ITEM</th><th>PREVIOUS MONTH STOCK QUANTITY</th><th>RECEIVED STOCK QUANTITY</th><th>CURRENT QUANTITY</th><th>REMOVED</th><th>REMAINDER</th><th>STATUS</th>${columns.map(column => `<th>${esc(column.name)}</th>`).join("")}${admin ? "<th>ACTIONS</th>" : ""}</tr>`;
  const storesMarkup = stores.map(store => {
    const storeItems = items.filter(item => item.store === store);
    const expanded = state.openStore === store;
    const rows = storeItems.map(item => `<tr>
      <td><span class="sku">${esc(item.sku)}</span></td>
      <td><span class="item-name">${esc(item.name)}</span></td>
      <td>${number(item.previous_month_quantity)}</td>
      <td>${number(item.received_stock_quantity)}</td>
      <td>${number(item.current_quantity)}</td>
      <td>${number(item.removed)}</td>
      <td><strong>${number(item.remainder)}</strong><small class="cell-sub">${esc(item.unit)}</small></td>
      <td><span class="pill ${esc(item.status_color)}">${number(item.status_percent, 1)}%</span></td>
      ${columns.map(column => `<td>${esc(item.custom_values?.[column.id] || "—")}</td>`).join("")}
      ${admin ? `<td><div class="row-actions"><button type="button" data-action="receipt-item" data-id="${esc(item.id)}" title="Receive stock" aria-label="Receive stock for ${esc(item.name)}">＋</button><button type="button" data-action="edit-item" data-id="${esc(item.id)}" title="Edit item" aria-label="Edit ${esc(item.name)}">✎</button><button type="button" data-action="delete-item" data-id="${esc(item.id)}" title="Archive item" aria-label="Archive ${esc(item.name)}">×</button></div></td>` : ""}
    </tr>`).join("");
    const columnCount = 8 + columns.length + (admin ? 1 : 0);
    return `<section class="store-section"><button type="button" class="store-toggle ${expanded ? "active" : ""}" data-store-toggle="${esc(store)}" aria-expanded="${expanded}"><span>${esc(store)}</span><span class="store-count">${storeItems.length} ${storeItems.length === 1 ? "item" : "items"}</span><span class="store-chevron">${expanded ? "−" : "+"}</span></button><div class="store-content" ${expanded ? "" : "hidden"}><div class="table-scroll"><table class="data-table wide-table"><thead>${headings}</thead><tbody>${rows || `<tr><td colspan="${columnCount}"><div class="empty-state"><span>▦</span><strong>No items in ${esc(store)}</strong><p>${admin ? "Add an item and assign it to this store." : "Ask an administrator to add an item to this store."}</p></div></td></tr>`}</tbody></table></div></div></section>`;
  }).join("");
  const archiveButton = admin ? `<button type="button" class="button secondary" data-action="show-archive">Archived items (${state.archivedItems?.length || 0})</button>` : "";
  return `${pageHeading("CATALOG & BALANCES", "Inventory", "Search item balances across your store locations.", `${addButton}${archiveButton}`)}
    <section class="card inventory-card">
      <div class="table-toolbar"><label class="search-input"><span>⌕</span><input id="inventory-search" placeholder="Search SKU or item name" value="${esc(query)}" /></label><select id="inventory-category"><option value="">All categories</option>${categoryOptions(category)}</select><span class="result-count">${items.length} active items</span></div>
      <div class="store-list">${storesMarkup}</div>
      <div class="table-note">Removed is the total issued or otherwise removed this month. Remainder equals current quantity minus removed. Status shows the remaining percentage; green 80–100%, yellow 20–70%, red 0–10%.</div>
    </section>`;
}

function renderRequests(data = state.requests) {
  if (!data) return `<div class="loading-content"><span class="spinner"></span> Loading stock requests…</div>`;
  state.requests = data;
  const stores = ["All Stock Requests", ...(state.bootstrap.stores || [])];
  if (!stores.includes(state.openRequestStore)) state.openRequestStore = stores[0];
  const admin = state.bootstrap.user.role === "admin";
  const sections = stores.map(store => {
    const all = store === "All Stock Requests";
    const rows = data.rows.filter(row => all || row.request_store === store);
    const expanded = state.openRequestStore === store;
    const body = rows.map(row => `<tr>
      <td>${prettyDate(row.request_date)}</td>
      <td><span class="sku">${esc(row.item_sku)}</span></td>
      <td><strong>${esc(row.item_name)}</strong>${!all ? "" : `<small class="cell-sub">${esc(row.request_store)}</small>`}</td>
      <td>${number(row.quantity_requested)} ${esc(row.unit)}</td>
      <td>${esc(row.person || "—")}</td>
      <td>${esc(row.issued_by || "—")}</td>
      ${admin ? `<td><div class="admin-row-actions"><button class="button small secondary" data-action="edit-request" data-id="${esc(row.id)}">Edit</button><button class="button small danger" data-action="remove-request" data-id="${esc(row.id)}">Remove</button></div></td>` : ""}
    </tr>`).join("");
    const colspan = admin ? 7 : 6;
    return `<section class="store-section"><button type="button" class="store-toggle ${expanded ? "active" : ""}" data-request-store="${esc(store)}" aria-expanded="${expanded}"><span>${esc(store)}</span><span class="store-count">${rows.length} ${rows.length === 1 ? "request" : "requests"}</span><span class="store-chevron">${expanded ? "−" : "+"}</span></button><div class="store-content" ${expanded ? "" : "hidden"}><div class="table-scroll"><table class="data-table wide-table"><thead><tr><th>DATE</th><th>SKU</th><th>ITEM</th><th>QUANTITY REQUESTED</th><th>REQUESTED USER</th><th>ISSUED BY</th>${admin ? "<th>ACTIONS</th>" : ""}</tr></thead><tbody>${body || `<tr><td colspan="${colspan}"><div class="empty-state"><span>◷</span><strong>No requests recorded</strong><p>Issued stock requests will appear here.</p></div></td></tr>`}</tbody></table></div></div></section>`;
  }).join("");
  return `${pageHeading("ISSUED STOCK HISTORY", "Requests", "Review stock issued to requesters by date and store.")}<section class="card inventory-card"><div class="store-list">${sections}</div><div class="table-note">Request quantities are combined across stock batches. Corrections and removals update inventory and reports; the movement audit retains the original history.</div></section>`;
}

function renderDepartmentFields(department = "") {
  const people = state.bootstrap.people[department] || [];
  const departmentKind = state.bootstrap.departmentKinds?.[department] || "standard";
  const isSpecial = ["expiry", "spoilage"].includes(departmentKind);
  const nameMarkup = isSpecial ? `<div class="special-dept-note">This entry is recorded as a ${esc(department.toLowerCase())} movement; no requester name is needed.</div>` :
    `<label class="form-field"><span>REQUESTED BY *</span><select name="person" required><option value="">Choose a name</option>${people.map(person => `<option value="${esc(person)}">${esc(person)}</option>`).join("")}</select></label>`;
  const areas = departmentKind === "housekeeping" ? `<div class="areas-box"><div class="area-head"><strong>Select areas *</strong><button type="button" class="link-button" data-action="select-all-areas">Select all</button></div><div class="area-grid">${state.bootstrap.areas.map(area => `<label><input type="checkbox" name="areas" value="${esc(area)}"><span>${esc(area)}</span></label>`).join("")}</div></div>` : "";
  return `${nameMarkup}${areas}`;
}

function itemSelectOptions(locationId = "") {
  const location = state.inventory.locations.find(entry => entry.id === locationId);
  const items = state.issueItems.filter(item =>
    item.active && item.on_hand > 0 && location && item.store === location.name,
  );
  return [
    { value: "", label: location ? "Choose stock item" : "Choose a store location first" },
    ...items.map(item => ({ value: item.id, label: `${item.name} · ${item.sku} · ${number(item.on_hand)} ${item.unit}` })),
  ];
}

function renderIssue() {
  const admin = state.bootstrap.user.role === "admin";
  if (!state.inventory.locations.length) return `<div class="empty-state"><strong>No active stock locations</strong><p>Ask an administrator to configure a location.</p></div>`;
  const selectedLocation = document.querySelector('#stock-issue-form [name="locationId"]')?.value || "";
  return `${pageHeading("STOCK REQUISITION", "Issue stock", "Record department requests, stock issues, expiry, or spoilage.", `<span class="local-tag"><i></i> INVENTORY VALIDATED</span>`)}
    <form id="stock-issue-form" class="issue-layout">
      <div class="issue-left">
        <section class="card issue-card"><div class="form-section-title"><span>01</span><div><h2>Requisition details</h2><p>Identify the department and receiving location.</p></div></div>
          <div class="form-grid two-col">${field("DEPARTMENT *", "department", "text", { required: true, select: ["", ...state.bootstrap.departments.map(value => ({ value, label: value }))] })}${field("STORE LOCATION *", "locationId", "text", { required: true, select: [{ value: "", label: "Choose location" }, ...state.inventory.locations.map(location => ({ value: location.id, label: location.name }))] })}${field("REQUEST DATE *", "date", "date", { required: true, value: dateKey() })}${field("ISSUED BY *", "issuedBy", "text", { required: true, maxlength: 120, value: state.bootstrap.user.displayName, placeholder: "Name of issuing staff" })}<div class="department-fields" id="department-fields"></div><label class="form-field wide-field"><span>NOTES</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Optional delivery or request notes"></textarea></label></div>
        </section>
        <section class="card issue-card"><div class="form-section-title"><span>02</span><div><h2>Items to issue</h2><p>Available stock is deducted using earliest-expiring batches first.</p></div></div>
          <div class="line-entry">${field("ITEM *", "line-item", "text", { select: itemSelectOptions(selectedLocation) })}${field("QUANTITY *", "line-quantity", "number", { min: "0.001", step: "0.001", value: 1, required: true })}<button type="button" class="button secondary" data-action="add-line">Add line</button></div>
          <div id="issue-lines" class="selected-lines"><div class="empty-lines">Select an item and add it to this requisition.</div></div>
          <label class="form-field"><span>ISSUE TYPE</span><div class="kind-note" id="issue-kind-note">Regular department requisition</div></label>
        </section>
      </div>
      <aside class="card submit-card"><span class="section-label">REVIEW &amp; SUBMIT</span><h2>Ready to issue?</h2><p>Stock is checked at each line's selected store before the request is saved.</p><div class="review-stats"><span>ITEM LINES<strong id="issue-line-count">0</strong></span><span>STORES<strong id="issue-location-summary">—</strong></span></div>${button("Submit requisition →", "submit-stock", { primary: true, type: "submit" })}<div class="security-note">⚿ Every movement is permanently recorded with the issuing user and time.</div>
      ${admin ? `<div class="admin-shortcut"><strong>Admin tools</strong><p>Receive or adjust stock from the inventory item actions.</p><button type="button" class="link-button" data-page="Inventory">Manage inventory →</button></div>` : ""}
      </aside>
    </form>`;
}

function addIssueLine(itemId, quantity) {
  const item = state.issueItems.find(entry => entry.id === itemId);
  if (!item) throw new Error("Choose an item from the stock catalog.");
  const locationId = document.querySelector('#stock-issue-form [name="locationId"]')?.value || "";
  const location = state.inventory.locations.find(entry => entry.id === locationId);
  if (!location) throw new Error("Choose a store location before selecting stock items.");
  if (item.store !== location.name) throw new Error("Choose an item from the selected store.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a quantity greater than zero.");
  const existing = document.querySelector(`#issue-lines [data-line="${item.id}"]`);
  if (existing) {
    const input = existing.querySelector("input");
    const next = Number(input.value) + quantity;
    if (next > item.on_hand) throw new Error(`Requested quantity exceeds available stock (${number(item.on_hand)} ${item.unit}).`);
    input.value = String(next);
  } else {
    if (quantity > item.on_hand) throw new Error(`Requested quantity exceeds available stock (${number(item.on_hand)} ${item.unit}).`);
    const container = document.querySelector("#issue-lines");
    if (container.querySelector(".empty-lines")) container.innerHTML = "";
    const row = document.createElement("div");
    row.className = "selected-line";
    row.dataset.line = item.id;
    row.dataset.locationId = location.id;
    row.dataset.available = String(item.on_hand);
    row.dataset.itemName = item.name;
    row.innerHTML = `<span class="line-item-name"><strong>${esc(item.name)}</strong><small>${esc(item.sku)} · ${number(item.on_hand)} ${esc(item.unit)} available · ${esc(location.name)}</small></span><input type="number" min="0.001" step="0.001" value="${quantity}" aria-label="Quantity of ${esc(item.name)}"><span>${esc(item.unit)}</span><button type="button" data-action="remove-line" aria-label="Remove ${esc(item.name)}">×</button>`;
    container.append(row);
  }
  updateIssueSummary();
}

function updateIssueSummary() {
  const count = document.querySelectorAll(".selected-line").length;
  const countElement = document.querySelector("#issue-line-count");
  if (countElement) countElement.textContent = String(count);
  const location = document.querySelector("#stock-issue-form [name=\"locationId\"]");
  const summary = document.querySelector("#issue-location-summary");
  if (summary) summary.textContent = count
    ? `${count} line${count === 1 ? "" : "s"} · ${new Set([...document.querySelectorAll(".selected-line")].map(line => line.dataset.locationId)).size} store${new Set([...document.querySelectorAll(".selected-line")].map(line => line.dataset.locationId)).size === 1 ? "" : "s"}`
    : location?.selectedOptions?.[0]?.textContent || "—";
  const department = document.querySelector("#stock-issue-form [name=\"department\"]")?.value || "";
  const kindNote = document.querySelector("#issue-kind-note");
  const kind = state.bootstrap.departmentKinds?.[department] || "standard";
  if (kindNote) kindNote.textContent = ["expiry", "spoilage"].includes(kind)
    ? `${department} — stock removed from inventory`
    : "Regular department requisition";
}

function renderMovements(result = state.transactions) {
  state.transactions = result || { rows: [], count: 0 };
  const data = state.transactions;
  const admin = state.bootstrap.user.role === "admin";
  const rows = data.rows.map(row => `<tr class="${row.voided_at ? "voided-row" : ""}"><td>${prettyDate(row.request_date)}${row.voided_at ? `<small class="cell-sub">VOIDED · ${esc(row.void_reason)}</small>` : ""}</td><td><span class="sku">${esc(row.item_sku)}</span></td><td><strong>${esc(row.item_name)}</strong>${row.reversal_of ? `<small class="cell-sub">Reversal of ${esc(row.reversal_of)}</small>` : ""}</td><td>${esc(row.category)}</td><td>${esc(row.location_name)}</td><td>${statusPill(row.kind)}</td><td class="${row.quantity > 0 ? "positive" : "negative"}"><strong>${row.quantity > 0 ? "+" : ""}${number(row.quantity)}</strong> ${esc(row.unit)}</td><td>${esc(row.department || "—")}</td><td>${esc(row.person || "—")}</td><td>${esc(row.issued_by || "—")}</td><td>${esc(row.created_by)}</td>${admin ? `<td><div class="admin-row-actions">${!row.voided_at && !row.reversal_of ? `<button class="button small secondary" data-action="edit-movement" data-id="${row.id}">Edit</button><button class="button small danger" data-action="void-movement" data-id="${row.id}">Void</button>` : "—"}</div></td>` : ""}</tr>`).join("");
  const filters = state.movementFilters || { from: `${dateKey().slice(0, 8)}01`, to: dateKey(), category: "", kind: "" };
  const filter = `<div class="movement-filters"><label class="filter-field"><span>FROM</span><input type="date" id="movement-from" value="${esc(filters.from)}"></label><label class="filter-field"><span>TO</span><input type="date" id="movement-to" value="${esc(filters.to)}"></label><select id="movement-category"><option value="">All categories</option>${categoryOptions(filters.category)}</select><select id="movement-kind"><option value="" ${!filters.kind ? "selected" : ""}>All movement types</option>${["receipt","requisition","issue","adjustment","expiry","spoilage"].map(kind => `<option ${filters.kind === kind ? "selected" : ""}>${kind}</option>`).join("")}</select><button class="button secondary" data-action="filter-movements">Apply filters</button></div>`;
  const colspan = admin ? 12 : 11;
  return `${pageHeading("AUDITABLE INVENTORY", "Stock movements", "Every receipt, requisition, adjustment, expiry and spoilage event.", button("↓ Export CSV", "export-movements"))}
    <section class="card inventory-card"><div class="movement-filter-wrap">${filter}</div><div class="table-scroll"><table class="data-table wide-table"><thead><tr><th>DATE</th><th>SKU</th><th>ITEM</th><th>CATEGORY</th><th>LOCATION</th><th>TYPE</th><th>QUANTITY</th><th>DEPARTMENT</th><th>PERSON</th><th>ISSUED BY</th><th>RECORDED BY</th>${admin ? "<th>ACTIONS</th>" : ""}</tr></thead><tbody>${rows || `<tr><td colspan="${colspan}"><div class="empty-state"><span>◷</span><strong>No movements found</strong><p>Stock activity will be recorded here.</p></div></td></tr>`}</tbody></table></div><div class="table-note">Showing all ${data.count} matching movements. Dates are filtered by the recorded request date.</div></section>`;
}

function renderAuditor(data = state.auditor) {
  if (!data) return `<div class="loading-content"><span class="spinner"></span> Loading audit records…</div>`;
  state.auditor = data;
  const activeItems = data.inventory.filter(item => item.active);
  const low = activeItems.filter(item => item.stock_status === "Low stock" || item.stock_status === "Out of stock").length;
  const voided = data.movements.filter(movement => movement.voided_at).length;
  const inventoryRows = data.inventory.map(item => `<tr><td><span class="sku">${esc(item.sku)}</span></td><td><strong>${esc(item.name)}</strong></td><td>${esc(item.category)}</td><td>${esc(item.unit)}</td><td>${number(item.on_hand)}</td><td>${item.active ? statusPill(item.stock_status) : statusPill("Archived")}</td></tr>`).join("");
  const movementRows = data.movements.map(movement => `<tr class="${movement.voided_at ? "voided-row" : ""}"><td>${prettyDate(movement.request_date)}</td><td>${esc(movement.item_sku)}</td><td>${esc(movement.item_name)}</td><td>${esc(movement.category)}</td><td>${esc(movement.location_name)}</td><td>${esc(movement.kind)}${movement.voided_at ? " · VOIDED" : ""}</td><td class="${movement.quantity > 0 ? "positive" : "negative"}">${movement.quantity > 0 ? "+" : ""}${number(movement.quantity)} ${esc(movement.unit)}</td><td>${esc(movement.created_by)}</td></tr>`).join("");
  const waterRows = data.waterRecords.map(record => `<tr><td>${prettyDate(record.date)}</td><td>${esc(record.recipient)}</td><td>${record.quantity}</td><td>${esc(record.requested_by)}</td><td>${esc(record.issued_by)}</td><td>${esc(record.created_by)}</td></tr>`).join("");
  const auditRows = data.audit.map(entry => `<tr><td>${prettyDateTime(entry.created_at)}</td><td>${esc(entry.actor_name)}</td><td>${esc(entry.action)}</td><td>${esc(entry.detail)}</td></tr>`).join("");
  return `${pageHeading("INDEPENDENT REVIEW", "Auditor workspace", "Read-only access to inventory, stock movements, water distribution and the audit log.")}
    <section class="stat-grid">${stat("ACTIVE ITEMS", number(activeItems.length, 0), "Catalog items currently enabled", "▦")}${stat("STOCK ON HAND", number(activeItems.reduce((sum, item) => sum + item.on_hand, 0)), "Across active inventory items", "◈", "mint")}${stat("LOW / OUT OF STOCK", String(low), "Items requiring review", "!", "amber")}${stat("VOIDED MOVEMENTS", String(voided), "Original rows retained with reversals", "↶", "blue")}</section>
    <section class="card inventory-card auditor-card"><div class="panel-heading"><div><span class="section-label">CATALOG & BALANCES</span><h2>Inventory review</h2></div><span class="count-chip">${data.inventory.length} items, including archived</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>SKU</th><th>ITEM</th><th>CATEGORY</th><th>UNIT</th><th>ON HAND</th><th>STATUS</th></tr></thead><tbody>${inventoryRows || `<tr><td colspan="6">No stock items recorded.</td></tr>`}</tbody></table></div></section>
    <section class="card inventory-card auditor-card"><div class="panel-heading"><div><span class="section-label">FULL MOVEMENT LEDGER</span><h2>Stock movements</h2></div><span class="count-chip">${data.movements.length} movements</span></div><div class="table-scroll"><table class="data-table wide-table"><thead><tr><th>DATE</th><th>SKU</th><th>ITEM</th><th>CATEGORY</th><th>LOCATION</th><th>TYPE / STATUS</th><th>QUANTITY</th><th>RECORDED BY</th></tr></thead><tbody>${movementRows || `<tr><td colspan="8">No stock movements recorded.</td></tr>`}</tbody></table></div></section>
    <section class="card inventory-card auditor-card"><div class="panel-heading"><div><span class="section-label">WATER DISTRIBUTION</span><h2>Water issues</h2></div><span class="count-chip">${data.waterRecords.length} entries</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>DATE</th><th>ROOM / AREA</th><th>PACKS</th><th>REQUESTED BY</th><th>ISSUED BY</th><th>RECORDED BY</th></tr></thead><tbody>${waterRows || `<tr><td colspan="6">No water issues recorded.</td></tr>`}</tbody></table></div></section>
    <section class="card inventory-card auditor-card"><div class="panel-heading"><div><span class="section-label">CHANGE HISTORY</span><h2>Audit log</h2></div><span class="count-chip">${data.audit.length} events</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>DETAIL</th></tr></thead><tbody>${auditRows || `<tr><td colspan="4">No audit events recorded.</td></tr>`}</tbody></table></div></section>`;
}

function renderWaterOverview(data) {
  const recipients = data.recipients || [];
  const issued = data.records.filter(record => record.date === data.today).length;
  const ready = recipients.filter(record => record.eligible).length;
  const card = recipient => {
    const record = recipient.lastRecord;
    let status;
    if (recipient.dailyAllowed) status = { label: record?.date === data.today ? "Issued today" : "Daily eligible", className: "water-daily" };
    else if (!record || recipient.eligible) status = { label: "Available", className: "water-available" };
    else status = { label: `${recipient.remainingDays}d cooldown`, className: "water-cooldown" };
    const exempt = WATER_EXEMPT.has(recipient.recipient);
    return `<div class="water-status-card ${status.className}"><div><i>${recipient.category === "room" ? "⌂" : "✦"}</i><span>${status.label}</span></div><strong>${esc(recipient.recipient)}</strong><small>${record ? `Last issue ${prettyDate(record.date)}` : "No issue recorded"}</small>${exempt ? `<em>EXEMPT</em>` : ""}</div>`;
  };
  const rooms = recipients.filter(recipient => recipient.category === "room");
  const staff = recipients.filter(recipient => recipient.category === "staff");
  return `${pageHeading("WATER DISTRIBUTION", "Water tracker", "Manage daily water issue status for rooms and special units.", button("＋ Issue water", "water-issue", { primary: true }))}
    <div class="stat-grid water-stat-grid">${stat("TRACKED LOCATIONS", "46", "41 rooms · 5 staff units", "▦")}${stat("ELIGIBLE TODAY", String(ready), "Available under current rules", "✓", "mint")}${stat("ISSUED TODAY", String(issued), "Entries recorded today", "↗", "blue")}${stat("COOLDOWN ROOMS", String(recipients.filter(item => !item.dailyAllowed && !item.eligible).length), "Rooms still in cooldown", "◷", "amber")}</div>
    <section class="water-group"><div class="panel-heading"><div><span class="section-label">SPECIAL UNITS</span><h2>Staff distribution</h2></div><span class="count-chip">5 units · daily eligible</span></div><div class="water-grid staff-grid">${staff.map(card).join("")}</div></section>
    <section class="water-group"><div class="panel-heading"><div><span class="section-label">ROOM DISTRIBUTION</span><h2>Rooms 1–41</h2><p>Standard cooldown of three full days. Exempt rooms are marked.</p></div><label class="search-input"><span>⌕</span><input id="water-filter" placeholder="Find a room" /></label></div><div class="water-grid" id="water-room-grid">${rooms.map(card).join("")}</div></section>`;
}

function waterRecipientOption(recipient) {
  const last = recipient.lastRecord;
  const stateLabel = recipient.dailyAllowed ? "Daily eligible" : recipient.eligible ? "Available" : `${recipient.remainingDays}d cooldown`;
  const exempt = WATER_EXEMPT.has(recipient.recipient);
  return `<label class="water-option ${recipient.eligible ? "" : "locked"}" data-water-option data-name="${esc(recipient.recipient.toLowerCase())}"><input type="checkbox" name="waterRecipients" value="${esc(recipient.recipient)}" ${recipient.eligible ? "" : "disabled"}><span class="checkmark"></span><strong>${esc(recipient.recipient)}</strong>${exempt ? "<em>EXEMPT</em>" : ""}<small>${last && last.date === state.water.today && !recipient.dailyAllowed ? "Issued today" : stateLabel}</small></label>`;
}

function renderWaterIssue(data) {
  state.water = data;
  const staff = data.recipients.filter(recipient => recipient.category === "staff");
  const rooms = data.recipients.filter(recipient => recipient.category === "room");
  return `${pageHeading("WATER ISSUE", "Issue bottled water", "Eligible recipients are recorded. Standard rooms in cooldown are skipped.", `<button class="button secondary" data-water-section="Overview">← Status overview</button>`)}
    <form id="water-issue-form" class="water-issue-layout"><section class="card water-picker"><div class="picker-header"><div><h2>Select recipients</h2><p>Choose rooms and staff units for this distribution.</p></div><div><button type="button" class="link-button" data-action="water-select-eligible">Select eligible</button><button type="button" class="link-button" data-action="water-clear">Clear</button></div></div><input class="water-search" id="water-search" placeholder="Search rooms or staff" /><div class="recipient-group"><div class="group-title">SPECIAL UNITS <span>DAILY ELIGIBLE</span></div><div class="water-option-grid staff-water-options">${staff.map(waterRecipientOption).join("")}</div></div><div class="recipient-group"><div class="group-title">ROOMS 1–41 <span>SELECT MULTIPLE</span></div><div class="water-option-grid">${rooms.map(waterRecipientOption).join("")}</div><p class="hint-line">Exempt rooms may receive water daily and ask for confirmation before issue.</p></div></section>
    <aside class="card water-details"><span class="section-label">ISSUANCE DETAILS</span><h2>Water request</h2><div class="selected-total"><strong id="water-selected-count">0</strong> recipients selected</div>${field("PACKS PER RECIPIENT *", "water-quantity", "number", { name: "quantity", required: true, min: 1, step: 1, value: 1 })}${field("REQUESTED BY *", "water-requested-by", "text", { name: "requestedBy", required: true, select: [{ value: "", label: "Select requester" }, ...state.bootstrap.waterRequesters] })}${field("ISSUED BY *", "water-issued-by", "text", { name: "issuedBy", required: true, maxlength: 120, value: state.bootstrap.user.displayName })}<div class="cooldown-note">Standard rooms are eligible again after three full days. Eligible special units continue when a selected room is skipped.</div>${button("Submit water issue →", "submit-water", { primary: true, type: "submit" })}</aside></form>`;
}

function renderWaterRecords(data) {
  const latest = new Map();
  for (const record of data.records) {
    const previous = latest.get(record.recipient);
    if (!previous || record.date > previous.date || (record.date === previous.date && record.created_at > previous.created_at)) latest.set(record.recipient, record);
  }
  const admin = state.bootstrap.user.role === "admin";
  const latestRows = [...latest.values()].sort((first, second) => first.recipient.localeCompare(second.recipient)).map(record => `<tr><td><strong>${esc(record.recipient)}</strong></td><td>${prettyDate(record.date)}</td><td>${record.quantity}</td><td>${esc(record.requested_by)}</td><td>${esc(record.issued_by)}</td></tr>`).join("");
  const history = data.records.map(record => `<tr><td class="select-cell">${admin ? `<input type="checkbox" name="waterRecordIds" value="${record.id}" aria-label="Select ${esc(record.recipient)} ${esc(record.date)}">` : ""}</td><td>${prettyDate(record.date)}</td><td>${esc(record.recipient)}</td><td>${record.quantity}</td><td>${esc(record.requested_by)}</td><td>${esc(record.issued_by)}</td><td>${esc(record.created_by)}</td>${admin ? `<td><button class="button small secondary" data-action="edit-water-record" data-id="${record.id}">Edit</button></td>` : ""}</tr>`).join("");
  const cleanup = admin ? `<button class="button danger" data-action="water-delete">Delete selected records</button>` : "";
  return `${pageHeading("WATER RECORDS", "Issuance records", "Review and manage the latest status and complete water distribution history.")}
    <section class="card inventory-card"><div class="panel-heading"><div><span class="section-label">ACTIVE TRACKING</span><h2>Latest records</h2></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>ROOM / AREA</th><th>LAST ISSUED</th><th>PACKS</th><th>REQUESTED BY</th><th>ISSUED BY</th></tr></thead><tbody>${latestRows || `<tr><td colspan="5"><div class="empty-state">No water records are active.</div></td></tr>`}</tbody></table></div></section>
    <section class="card inventory-card history-card"><div class="panel-heading"><div><span class="section-label">WATER HISTORY</span><h2>Recent water issues</h2></div><span class="count-chip">${data.records.length} records</span>${cleanup}</div><div class="table-scroll"><table class="data-table"><thead><tr>${admin ? "<th>SELECT</th>" : ""}<th>DATE</th><th>ROOM / AREA</th><th>PACKS</th><th>REQUESTED BY</th><th>ISSUED BY</th><th>RECORDED BY</th>${admin ? "<th>ACTIONS</th>" : ""}</tr></thead><tbody>${history || `<tr><td colspan="${admin ? 8 : 6}"><div class="empty-state">No water history yet.</div></td></tr>`}</tbody></table></div></section>`;
}

function renderWater(data = state.water) {
  if (!data) return `<div class="loading-content"><span class="spinner"></span> Loading water tracker…</div>`;
  state.water = data;
  const sections = state.bootstrap.user.role === "auditor" ? ["Overview", "Reports", "Records"] : ["Overview", "Issue", "Reports", "Records"];
  const heading = `<div class="section-tabs water-tabs">${sections.map(section => `<button class="${state.waterSection === section ? "active" : ""}" data-water-section="${section}">${section === "Records" && state.bootstrap.user.role === "admin" ? "Records & cleanup" : section === "Issue" ? "Issue water" : section === "Overview" ? "Status overview" : section}</button>`).join("")}</div>`;
  let body = "";
  if (state.waterSection === "Overview") body = renderWaterOverview(data);
  else if (state.waterSection === "Issue") body = renderWaterIssue(data);
  else if (state.waterSection === "Records") body = renderWaterRecords(data);
  else body = renderReports({ report: "water" });
  return `${heading}${body}`;
}

function reportControls(report = "stock") {
  const today = dateKey();
  const month = today.slice(0, 7);
  const isStock = report === "stock";
  const reportKind = isStock && ["requisition", "updates", "entries", "movements"].includes(state.reportSpec?.reportKind)
    ? state.reportSpec.reportKind : "requisition";
  const period = state.reportSpec?.report === report && ["daily", "range", "monthly"].includes(state.reportSpec.type)
    ? state.reportSpec.type : "daily";
  const reportNames = {
    requisition: "Requisition Report",
    updates: "Stock Updates Report",
    entries: "Entry Reports",
    movements: "All Movements Report",
  };
  const periodButtons = isStock
    ? `<div class="report-selector report-period-selector"><button type="button" class="${period === "daily" ? "active" : ""}" data-report-type="daily">Daily</button><button type="button" class="${period === "range" ? "active" : ""}" data-report-type="range">Date range</button></div>`
    : `<div class="report-selector report-period-selector"><button type="button" class="${period === "daily" ? "active" : ""}" data-report-type="daily">Daily</button><button type="button" class="${period === "range" ? "active" : ""}" data-report-type="range">Date range</button><button type="button" class="${period === "monthly" ? "active" : ""}" data-report-type="monthly">Monthly</button></div>`;
  return `<form id="report-form" class="report-form" data-report="${report}">
    ${isStock ? `<div class="report-selector report-kind-selector">${Object.entries(reportNames).map(([kind, label]) => `<button type="button" class="${kind === reportKind ? "active" : ""}" data-report-kind="${kind}">${label}</button>`).join("")}</div>` : ""}
    ${periodButtons}
    <div class="report-params">
      <label class="form-field report-date" data-report-period="daily" ${period !== "daily" || reportKind === "updates" ? "hidden" : ""}><span>REPORT DATE</span><input name="date" type="date" value="${today}"></label>
      <label class="form-field report-date" data-report-period="range" ${period !== "range" || reportKind === "updates" ? "hidden" : ""}><span>FROM</span><input name="from" type="date" value="${month}-01"></label>
      <label class="form-field report-date" data-report-period="range" ${period !== "range" || reportKind === "updates" ? "hidden" : ""}><span>TO</span><input name="to" type="date" value="${today}"></label>
      ${!isStock ? `<label class="form-field report-date" data-report-period="monthly" ${period !== "monthly" ? "hidden" : ""}><span>MONTH</span><input name="month" type="month" value="${month}"></label>` : ""}
      ${isStock ? `<label class="form-field store-param" data-report-kind-param="updates" ${reportKind !== "updates" ? "hidden" : ""}><span>STORE</span><select name="updatesStore">${state.bootstrap.stores.map(store => `<option value="${esc(store)}" ${state.reportSpec?.store === store ? "selected" : ""}>${esc(store)}</option>`).join("")}</select></label>` : ""}
      ${isStock ? `<label class="form-field store-param" data-report-kind-param="requisition" ${reportKind !== "requisition" ? "hidden" : ""}><span>REQUISITION STORE</span><select name="requisitionStore"><option value="" ${!state.reportSpec?.store ? "selected" : ""}>All Stock Requisition</option>${state.bootstrap.stores.map(store => `<option value="${esc(store)}" ${state.reportSpec?.store === store ? "selected" : ""}>${esc(store)} Requisition</option>`).join("")}</select></label>` : ""}
      <button class="button primary generate-report-button" type="submit">${reportKind === "updates" ? "Generate stock updates →" : `Generate ${isStock ? reportNames[reportKind].replace(" Report", "").replace(" Reports", "") : "report"} →`}</button>
    </div>
  </form>`;
}

function reportTable(report) {
  if (!report || !report.rows?.length) return `<div class="report-empty"><span>▤</span><strong>${report ? "No records for this period" : "Your report will appear here"}</strong><p>${report ? report.reportKind === "updates" ? "Select another store or add inventory to this store." : "Choose another date or date range." : "Choose the reporting period, then generate a report."}</p></div>`;
  const rows = report.rows.slice(0, 250).map(row => `<tr>${report.headers.map(header => `<td>${esc(row[header])}</td>`).join("")}</tr>`).join("");
  return `<div class="report-meta"><span>${report.rows.length} ${report.rows.length === 1 ? "row" : "rows"}${report.rows.length > 250 ? " · showing first 250" : ""}</span><span>${esc(report.title)}</span></div><div class="table-scroll"><table class="data-table report-table"><thead><tr>${report.headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderReports(options = {}) {
  const report = options.report || "stock";
  return `${pageHeading(report === "water" ? "WATER REPORTS" : "REPORTING & EXPORTS", report === "water" ? "Water reports" : "Reports & exports", report === "water" ? "Review water distribution by day, date range, or month." : "Build requisition, stock update, entry and movement reports.")}
    <section class="card report-builder-card"><div class="panel-heading"><div><span class="section-label">REPORT BUILDER</span><h2>${report === "water" ? "Water distribution" : "Stock reports"}</h2><p>${report === "water" ? "Use the date range or month to summarize activity." : "Choose a report, then select a day, date range, or store as needed."}</p></div><span class="report-icon">▤</span></div>${reportControls(report)}</section>
    <section class="card generated-card"><div class="generated-head"><div><span class="section-label">REPORT PREVIEW</span><h2 id="report-title">${state.report ? esc(state.report.title) : "Generated report"}</h2><p id="report-subtitle">${state.report ? `${esc(state.report.rows.length)} rows · generated ${prettyDate(dateKey())}` : "Generate a report to preview results here."}</p></div><div class="report-actions">${state.report ? `<button class="button secondary" data-action="download-report">↓ Export CSV</button>${state.bootstrap.user.role !== "auditor" ? `<button class="button primary" data-action="show-email">✉ Email report</button>` : ""}<button class="button secondary" data-action="print-report">▣ Print / PDF</button>` : ""}</div></div><div id="report-table-container">${reportTable(state.report)}</div>
      ${state.report && state.bootstrap.user.role !== "auditor" ? `<form id="report-email-form" class="email-report-form" hidden><div><strong>Send this report with Gmail</strong><small>${state.bootstrap.gmailConfigured ? "Gmail sender is configured for this session." : "An admin must configure a Gmail sender and App Password in Admin → Email."}</small></div><label class="form-field"><span>RECIPIENT EMAIL</span><input name="to" type="email" placeholder="recipient@example.com" required></label><button class="button primary" type="submit" ${state.bootstrap.gmailConfigured ? "" : "disabled"}>Send email →</button></form>` : ""}
    </section>`;
}

function itemModal(item = null) {
  const edit = Boolean(item);
  const loc = state.inventory.locations[0]?.id || "";
  const storeOptions = (state.bootstrap.stores || []).map(store => ({ value: store, label: store }));
  const columns = state.bootstrap.inventoryColumns || [];
  const stockColumns = `<div class="table-scroll stock-entry-table"><table class="data-table wide-table"><thead><tr><th>SKU</th><th>ITEM</th><th>PREVIOUS MONTH STOCK QUANTITY</th><th>RECEIVED STOCK QUANTITY</th><th>CURRENT QUANTITY</th><th>REMOVED</th><th>REMAINDER</th><th>STATUS</th>${columns.map(column => `<th>${esc(column.name)}</th>`).join("")}</tr></thead><tbody><tr><td><span id="stock-entry-sku">${esc(item?.sku || "—")}</span></td><td><span id="stock-entry-name">${esc(item?.name || "—")}</span></td><td><input name="previousMonthQuantity" type="number" min="0" step="0.001" value="${edit ? esc(item.previous_month_quantity) : "0"}" aria-label="Previous month stock quantity"></td><td><input name="receivedStockQuantity" type="number" min="0" step="0.001" value="${edit ? esc(item.received_stock_quantity) : "0"}" aria-label="Received stock quantity"></td><td>${edit ? `<span id="stock-entry-current">${number(item.current_quantity)}</span>` : `<input name="initialQuantity" type="number" min="0" step="0.001" value="0" aria-label="Current quantity">`}</td><td>${edit ? `<span id="stock-entry-removed">${number(item.removed)}</span>` : `<span id="stock-entry-removed">0</span>`}</td><td>${edit ? `<strong id="stock-entry-remainder">${number(item.remainder)}</strong>` : `<strong id="stock-entry-remainder">0</strong>`}</td><td>${edit ? `<span id="stock-entry-status" class="pill ${esc(item.status_color)}">${number(item.status_percent, 1)}%</span>` : `<span id="stock-entry-status" class="pill danger">0%</span>`}</td>${columns.map(column => `<td><input data-custom-column="${esc(column.id)}" type="text" maxlength="500" value="${esc(item?.custom_values?.[column.id] || "")}" aria-label="${esc(column.name)}"></td>`).join("")}</tr></tbody></table></div>`;
  const selectedStore = item?.store || "";
  const selectedCategory = item?.category || categoryForStore(selectedStore);
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-heading"><div class="modal-heading"><div><span class="section-label">${edit ? "CATALOG MANAGEMENT" : "NEW STOCK ITEM"}</span><h2 id="modal-heading">${edit ? "Edit item" : "Add inventory item"}</h2><p>${edit ? "Update product details and reorder settings." : "Create the catalog item and enter its previous-month and current quantities."}</p></div><button type="button" class="modal-close" data-action="close-modal">×</button></div>
  <form id="item-form" data-item-id="${item?.id || ""}"><div class="form-grid two-col">${field("SKU *", "sku", "text", { required: true, maxlength: 40, value: item?.sku || "", placeholder: "e.g. DRY-001" })}${field("ITEM NAME *", "name", "text", { required: true, maxlength: 120, value: item?.name || "", placeholder: "Enter product name" })}${field("STORE *", "store", "text", { required: true, select: [{ value: "", label: "Choose store" }, ...storeOptions], value: selectedStore })}${field("CATEGORY *", "category", "text", { required: true, select: [{ value: "", label: "Choose category" }, ...state.bootstrap.categories], value: selectedCategory })}${field("UNIT *", "unit", "text", { required: true, maxlength: 24, value: item?.unit || "pieces", placeholder: "packs, kg, bottles" })}${field("LOW-STOCK ALERT AT", "reorderLevel", "number", { min: 0, step: "0.001", value: item?.reorder_level ?? 0 })}${!edit ? field("STOCK LOCATION *", "locationId", "text", { required: true, select: [{ value: "", label: "Choose location" }, ...state.inventory.locations.map(location => ({ value: location.id, label: location.name }))], value: loc }) : ""}${!edit ? field("EXPIRY DATE (OPTIONAL)", "expiryDate", "date", {}) : ""}</div><h3 class="stock-entry-heading">${edit ? "Current month stock summary" : "Opening stock columns"}</h3>${stockColumns}${!edit ? `<p class="stock-entry-note">Current Quantity is calculated from previous-month stock plus received stock. Change Current Quantity to override it; Received Stock Quantity updates to keep the total consistent. Removed starts at zero and new issues update it automatically.</p>` : `<p class="stock-entry-note">Changing previous-month or received stock quantity records an auditable stock correction and updates the on-hand balance.</p>`}<div class="modal-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button primary">${edit ? "Save changes" : "Create item"}</button></div></form></section></div>`;
}

function stockModal(action, item) {
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><div class="modal-heading"><div><span class="section-label">GOODS RECEIVED</span><h2>Receive stock</h2><p><strong>${esc(item.name)} · ${esc(item.sku)}</strong> · current balance ${number(item.on_hand)} ${esc(item.unit)}.</p></div><button type="button" class="modal-close" data-action="close-modal">×</button></div>
    <form id="receipt-form" data-item-id="${item.id}"><div class="form-grid two-col">${field("QUANTITY RECEIVED *", "quantity", "number", { required: true, min: "0.001", step: "0.001", placeholder: "Enter received quantity" })}${field("LOCATION *", "locationId", "text", { required: true, select: state.inventory.locations.map(location => ({ value: location.id, label: location.name })) })}${field("SUPPLIER", "supplier", "text", { maxlength: 160, placeholder: "Supplier or vendor" })}${field("PURCHASE / DELIVERY REF", "purchaseReference", "text", { maxlength: 120, placeholder: "Invoice or delivery note" })}${field("UNIT COST", "unitCost", "number", { min: 0, step: "0.01", value: 0 })}${field("BATCH NUMBER", "batchNumber", "text", { maxlength: 120, placeholder: "Optional batch ID" })}${field("EXPIRY DATE", "expiryDate", "date", {})}<label class="form-field wide-field"><span>NOTES</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Optional notes"></textarea></label></div><div class="modal-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button primary">Save receipt</button></div></form></section></div>`;
}

function waterRecordModal(record) {
  const requesterChoices = state.bootstrap.waterRequesters.map(name => ({ value: name, label: name }));
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-heading"><div class="modal-heading"><div><span class="section-label">ADMIN RECORD CORRECTION</span><h2 id="modal-heading">Edit water issue</h2><p>Changes to historical dates are checked against room cooldowns.</p></div><button type="button" class="modal-close" data-action="close-modal">×</button></div><form id="water-record-form" data-record-id="${esc(record.id)}"><div class="form-grid two-col">${field("ISSUE DATE *", "date", "date", { required: true, value: record.date })}${field("ROOM / AREA *", "recipient", "text", { required: true, select: [...state.bootstrap.waterRooms, ...state.bootstrap.waterStaff].map(name => ({ value: name, label: name })), value: record.recipient })}${field("PACKS *", "quantity", "number", { required: true, min: 1, step: 1, value: record.quantity })}${field("REQUESTED BY *", "requestedBy", "text", { required: true, select: requesterChoices, value: record.requested_by })}${field("ISSUED BY *", "issuedBy", "text", { required: true, maxlength: 120, value: record.issued_by })}</div><div class="modal-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button primary">Save correction</button></div></form></section></div>`;
}

function movementModal(movement) {
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-heading"><div class="modal-heading"><div><span class="section-label">ADMIN STOCK CORRECTION</span><h2 id="modal-heading">Edit movement</h2><p><strong>${esc(movement.item_name)} · ${esc(movement.item_sku)}</strong>. Stock balance changes are validated against the linked batch.</p></div><button type="button" class="modal-close" data-action="close-modal">×</button></div><form id="movement-form" data-movement-id="${esc(movement.id)}"><div class="form-grid two-col">${field("REQUEST DATE *", "requestDate", "date", { required: true, value: movement.request_date })}${field("SIGNED QUANTITY *", "quantity", "number", { required: true, step: "0.001", value: movement.quantity })}${field("DEPARTMENT", "department", "text", { maxlength: 80, value: movement.department })}${field("PERSON", "person", "text", { maxlength: 80, value: movement.person })}${field("ISSUED BY", "issuedBy", "text", { maxlength: 120, value: movement.issued_by })}<label class="form-field wide-field"><span>AREA</span><input name="area" maxlength="500" value="${esc(movement.area)}"></label><label class="form-field wide-field"><span>REASON</span><input name="reason" maxlength="500" value="${esc(movement.reason)}"></label><label class="form-field wide-field"><span>NOTES</span><textarea name="notes" rows="2" maxlength="1000">${esc(movement.notes)}</textarea></label></div><p class="hint-line">Quantity must keep its original positive/negative direction. Use Void to reverse a movement instead.</p><div class="modal-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button primary">Save correction</button></div></form></section></div>`;
}

function requestModal(request) {
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="modal-heading"><div class="modal-heading"><div><span class="section-label">ADMIN REQUEST CORRECTION</span><h2 id="modal-heading">Edit stock request</h2><p>${esc(request.item_name)} · ${esc(request.item_sku)}. The corrected quantity is reconciled against available stock.</p></div><button type="button" class="modal-close" data-action="close-modal">×</button></div><form id="request-form" data-request-id="${esc(request.id)}">${field("ISSUE DATE *", "requestDate", "date", { required: true, value: request.request_date })}${field("QUANTITY REQUESTED *", "quantity", "number", { required: true, min: "0.001", step: "0.001", value: request.quantity_requested })}${field("REQUESTED USER", "person", "text", { maxlength: 80, value: request.person })}${field("ISSUED BY", "issuedBy", "text", { maxlength: 120, value: request.issued_by })}<div class="modal-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button primary">Save correction</button></div></form></section></div>`;
}

function voidMovementModal(movement, isRequest = false) {
  const formId = isRequest ? "void-request-form" : "void-movement-form";
  const formData = isRequest ? `data-request-id="${esc(movement.id)}"` : `data-movement-id="${esc(movement.id)}"`;
  const quantity = Math.abs(Number(movement.quantity ?? movement.quantity_requested));
  const label = isRequest ? "Remove request?" : "Void movement?";
  const action = isRequest ? "Remove request" : "Void and reverse";
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="modal-heading"><div class="modal-heading"><div><span class="section-label">AUDIT-SAFE REVERSAL</span><h2 id="modal-heading">${label}</h2><p>${esc(movement.item_name)} · ${number(quantity)} ${esc(movement.unit)}. The original remains in the movement audit and stock is restored.</p></div><button type="button" class="modal-close" data-action="close-modal">×</button></div><form id="${formId}" ${formData}>${field("REASON FOR REVERSAL *", "reason", "text", { required: true, minlength: 3, maxlength: 500, placeholder: "Explain the correction" })}<div class="modal-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button danger">${action}</button></div></form></section></div>`;
}

function renderAdmin(data = state.admin) {
  if (!data) return `<div class="loading-content"><span class="spinner"></span> Loading admin settings…</div>`;
  state.admin = data;
  const tabs = ["Users", "Requesters", "Departments", "Housekeeping Areas", "Categories", "Locations", "Inventory columns", "Appearance", "Email", "Audit log", "Clear All"].map(section => `<button class="${state.adminSection === section ? "active" : ""}" data-admin-section="${section}">${section}</button>`).join("");
  let content = "";
  if (state.adminSection === "Users") {
    const users = data.users.map(user => `<tr><td><input class="inline-edit" data-user-name="${user.id}" value="${esc(user.displayName)}" aria-label="Display name for ${esc(user.username)}"><small class="cell-sub">@${esc(user.username)}</small></td><td><select class="user-role" data-user-role="${user.id}" ${user.id === state.bootstrap.user.id ? "disabled" : ""}><option value="user" ${user.role === "user" ? "selected" : ""}>Standard user</option><option value="auditor" ${user.role === "auditor" ? "selected" : ""}>Auditor</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrator</option></select></td><td><select class="user-active" data-user-active="${user.id}" ${user.id === state.bootstrap.user.id ? "disabled" : ""}><option value="true" ${user.active ? "selected" : ""}>Enabled</option><option value="false" ${!user.active ? "selected" : ""}>Disabled</option></select>${user.passwordResetRequired ? `<small class="cell-sub">Password change required</small>` : ""}</td><td>${prettyDate(user.createdAt)}</td><td><div class="admin-row-actions"><button class="button small secondary" data-action="save-user" data-id="${user.id}">Save</button><button class="link-button" data-action="reset-user-password" data-id="${user.id}">${state.bootstrap.passwordPolicy === "strong" ? "Reset password" : "Reset PIN"}</button>${user.id !== state.bootstrap.user.id ? `<button class="button small danger" data-action="delete-user" data-id="${user.id}">Delete</button>` : ""}</div></td></tr>`).join("");
    content = `<div class="admin-grid"><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">ACCESS CONTROL</span><h2>Team accounts</h2><p>Admins manage stock, standard users enter requests, auditors have read-only access.</p></div><span class="count-chip">${data.users.length} accounts</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>USER</th><th>ROLE</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>${users}</tbody></table></div></section>
    <section class="card admin-card"><div class="panel-heading"><div><span class="section-label">INVITE STAFF</span><h2>Create an account</h2><p>${esc(passwordPolicyDescription())}</p></div></div><form id="user-form" class="stack-form">${field("USERNAME *", "username", "text", { required: true, minlength: 3, maxlength: 40, placeholder: "e.g. store.user" })}${field("DISPLAY NAME *", "displayName", "text", { required: true, minlength: 2, maxlength: 80 })}${field("ROLE *", "role", "text", { required: true, select: [{ value: "user", label: "Standard user" }, { value: "auditor", label: "Auditor (read-only)" }, { value: "admin", label: "Administrator" }] })}${passwordField(state.bootstrap.passwordPolicy === "strong" ? "PASSWORD *" : "4-DIGIT PASSWORD *", "password")}<button class="button primary" type="submit">Create account</button></form></section></div>`;
  } else if (state.adminSection === "Requesters") {
    const rows = data.requesters.map(person => `<tr><td>${person.scope === "water" ? "Water" : "Stock"}</td><td>${esc(person.department || "—")}</td><td><input class="inline-edit" data-requester-name="${person.id}" value="${esc(person.name)}" aria-label="Requester name"></td><td><select class="user-active" data-requester-active="${person.id}"><option value="true" ${person.active ? "selected" : ""}>Enabled</option><option value="false" ${!person.active ? "selected" : ""}>Disabled</option></select></td><td><div class="admin-row-actions"><button class="button small secondary" data-action="save-requester" data-id="${person.id}">Save</button><button class="button small danger" data-action="delete-requester" data-id="${person.id}">Delete</button></div></td></tr>`).join("");
    content = `<div class="admin-grid"><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">REQUESTER LISTS</span><h2>Stock and water requesters</h2><p>Names can be disabled or removed; existing records keep their saved names.</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>TYPE</th><th>DEPARTMENT</th><th>NAME</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${rows}</tbody></table></div></section><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">ADD REQUESTER</span><h2>New requester</h2></div></div><form id="requester-form" class="stack-form">${field("REQUEST TYPE *", "scope", "text", { required: true, select: [{ value: "water", label: "Water" }, { value: "stock", label: "Stock requisition" }] })}${field("DEPARTMENT", "department", "text", { select: [{ value: "", label: "Not applicable" }, ...state.bootstrap.departments.map(value => ({ value, label: value }))] })}${field("NAME *", "name", "text", { required: true, minlength: 2, maxlength: 80 })}<button class="button primary" type="submit">Add requester</button></form></section></div>`;
  } else if (state.adminSection === "Departments") {
    const rows = data.departments.map(department => `<tr><td><input class="inline-edit" data-department-name="${esc(department.id)}" value="${esc(department.name)}" aria-label="Department name"></td><td>${esc(department.kind[0].toUpperCase() + department.kind.slice(1))}</td><td><div class="admin-row-actions"><button class="button small secondary" data-action="save-department" data-id="${esc(department.id)}">Save</button><button class="button small danger" data-action="delete-department" data-id="${esc(department.id)}">Delete</button></div></td></tr>`).join("");
    content = `<div class="admin-grid"><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">REQUISITION DEPARTMENTS</span><h2>Manage departments</h2><p>Renaming updates requester assignments, issue forms, and report history. Deleting a department removes its requester choices; saved issue history remains.</p></div><span class="count-chip">${data.departments.length} departments</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>DEPARTMENT</th><th>TYPE</th><th>ACTIONS</th></tr></thead><tbody>${rows || `<tr><td colspan="3">No departments yet.</td></tr>`}</tbody></table></div></section><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">ADD DEPARTMENT</span><h2>New department</h2></div></div><form id="department-form" class="stack-form">${field("DEPARTMENT NAME *", "name", "text", { required: true, minlength: 2, maxlength: 80 })}${field("DEPARTMENT TYPE *", "kind", "text", { required: true, select: [{ value: "standard", label: "Standard" }, { value: "housekeeping", label: "Housekeeping (requires areas)" }, { value: "expiry", label: "Expiry (no requester)" }, { value: "spoilage", label: "Spoilage (no requester)" }] })}<button class="button primary" type="submit">Add department</button></form></section></div>`;
  } else if (state.adminSection === "Housekeeping Areas") {
    const rows = data.housekeepingAreas.map(area => `<tr><td><input class="inline-edit" data-housekeeping-area-name="${esc(area.id)}" value="${esc(area.name)}" aria-label="Housekeeping area name"></td><td><div class="admin-row-actions"><button class="button small secondary" data-action="save-housekeeping-area" data-id="${esc(area.id)}">Save</button><button class="button small danger" data-action="delete-housekeeping-area" data-id="${esc(area.id)}">Delete</button></div></td></tr>`).join("");
    content = `<div class="admin-grid"><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">HOUSEKEEPING ISSUE AREAS</span><h2>Manage areas</h2><p>Only departments with the Housekeeping type show these choices in stock issue forms. Renames update the saved area labels in history.</p></div><span class="count-chip">${data.housekeepingAreas.length} areas</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>AREA</th><th>ACTIONS</th></tr></thead><tbody>${rows || `<tr><td colspan="2">No areas yet.</td></tr>`}</tbody></table></div></section><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">ADD AREA</span><h2>New housekeeping area</h2></div></div><form id="housekeeping-area-form" class="stack-form">${field("AREA NAME *", "name", "text", { required: true, minlength: 2, maxlength: 80 })}<button class="button primary" type="submit" ${data.departments.some(department => department.kind === "housekeeping") ? "" : "disabled"}>Add area</button>${data.departments.some(department => department.kind === "housekeeping") ? "" : `<small class="cell-sub">Create a department with the Housekeeping type before adding areas.</small>`}</form></section></div>`;
  } else if (state.adminSection === "Categories") {
    const rows = data.categories.map(category => `<tr><td><input class="inline-edit" data-category-name="${category.id}" value="${esc(category.name)}" aria-label="Category name"></td><td><select class="user-active" data-category-active="${category.id}"><option value="true" ${category.active ? "selected" : ""}>Enabled</option><option value="false" ${!category.active ? "selected" : ""}>Disabled</option></select></td><td><div class="admin-row-actions"><button class="button small secondary" data-action="save-category" data-id="${category.id}">Save</button><button class="button small danger" data-action="delete-category" data-id="${category.id}">Delete</button></div></td></tr>`).join("");
    content = `<div class="admin-grid"><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">INVENTORY TAXONOMY</span><h2>Stock categories</h2><p>Renaming a category updates all related catalog items; delete is blocked while items use it.</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>CATEGORY</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${rows}</tbody></table></div></section><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">EXPAND CATALOG</span><h2>Add category</h2></div></div><form id="category-form" class="stack-form">${field("CATEGORY NAME *", "name", "text", { required: true, minlength: 2, maxlength: 60 })}<button class="button primary" type="submit">Add category</button></form></section></div>`;
  } else if (state.adminSection === "Inventory columns") {
    const rows = data.inventoryColumns.map(column => `<tr><td><input class="inline-edit" data-inventory-column-name="${esc(column.id)}" value="${esc(column.name)}" aria-label="Inventory column name"></td><td><select class="user-active" data-inventory-column-active="${esc(column.id)}"><option value="true" ${column.active ? "selected" : ""}>Enabled</option><option value="false" ${!column.active ? "selected" : ""}>Disabled</option></select></td><td><div class="admin-row-actions"><button class="button small secondary" data-action="save-inventory-column" data-id="${esc(column.id)}">Save</button><button class="button small danger" data-action="delete-inventory-column" data-id="${esc(column.id)}">Delete</button></div></td></tr>`).join("");
    content = `<div class="admin-grid"><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">CUSTOM INVENTORY FIELDS</span><h2>Inventory columns</h2><p>Rename, enable or delete custom fields. Required stock columns stay fixed so inventory calculations remain intact.</p></div><span class="count-chip">${data.inventoryColumns.length} columns</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>COLUMN NAME</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${rows || `<tr><td colspan="3"><div class="empty-state"><span>▦</span><strong>No custom columns</strong><p>Add a column to collect extra details for each stock item.</p></div></td></tr>`}</tbody></table></div></section><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">EXPAND INVENTORY</span><h2>Add column</h2><p>Custom values appear in store inventory and stock updates reports.</p></div></div><form id="inventory-column-form" class="stack-form">${field("COLUMN NAME *", "name", "text", { required: true, minlength: 2, maxlength: 60, placeholder: "e.g. Storage shelf" })}<button class="button primary" type="submit">Add column</button></form></section></div>`;
  } else if (state.adminSection === "Email") {
    content = `<section class="card admin-card email-config"><div class="panel-heading"><div><span class="section-label">GMAIL DELIVERY</span><h2>Report email settings</h2><p>Generate reports locally, then send them as CSV attachments through Gmail.</p></div><span class="mail-icon">✉</span></div><form id="mail-config-form" class="email-config-form"><div class="form-grid two-col">${field("GMAIL SENDER ADDRESS *", "gmailAddress", "email", { required: true, value: data.settings.gmailAddress, placeholder: "reports@gmail.com" })}${field("GOOGLE APP PASSWORD *", "appPassword", "password", { required: true, maxlength: 32, autocomplete: "new-password", placeholder: "16-character App Password" })}</div><div class="email-safety"><strong>⚿ Password is memory-only</strong><p>The app password is never written to the database. It is cleared when the local server exits; enter it again after restarting. Use a Google App Password, not your main Google password.</p></div><button class="button primary" type="submit">Save Gmail sender</button><span class="configured-badge ${data.settings.appPasswordConfigured ? "ready" : ""}">${data.settings.appPasswordConfigured ? "Ready for this session" : "Not configured this session"}</span></form></section>`;
  } else if (state.adminSection === "Appearance") {
    content = `<section class="card admin-card appearance-card"><div class="panel-heading"><div><span class="section-label">WORKSPACE DESIGN</span><h2>Appearance</h2><p>Set the shared surface style, typography, accent color and readable text size.</p></div><span class="count-chip">Applies to all users</span></div><form id="appearance-form" class="stack-form"><div class="form-grid two-col">${field("SURFACE STYLE", "style", "text", { required: true, select: [{ value: "glass", label: "Soft glass" }, { value: "classic", label: "Classic solid" }], value: data.settings.appearanceStyle || "glass" })}${field("TYPOGRAPHY", "fontFamily", "text", { required: true, select: [{ value: "inter", label: "Inter" }, { value: "manrope", label: "Manrope" }], value: data.settings.appearanceFont || "inter" })}${field("ACCENT COLOR", "accent", "text", { required: true, select: [{ value: "teal", label: "Capitol teal" }, { value: "blue", label: "Blue" }, { value: "violet", label: "Violet" }, { value: "orange", label: "Warm orange" }], value: data.settings.appearanceAccent || "teal" })}${field("TEXT SIZE", "textSize", "text", { required: true, select: [{ value: "normal", label: "Standard" }, { value: "large", label: "Large" }], value: data.settings.appearanceTextSize || "normal" })}</div><div class="appearance-preview"><span class="appearance-preview-dot"></span><span><strong>Shared workspace style</strong><small>Settings apply to dashboards, tables, forms and notifications after saving.</small></span><button type="submit" class="button primary">Save appearance</button></div></form></section>`;
  } else if (state.adminSection === "Locations") {
    const locations = data.locations.map(location => `<tr><td><input class="inline-edit" data-location-name="${location.id}" value="${esc(location.name)}" aria-label="Store name"></td><td><select class="user-active" data-location-active="${location.id}"><option value="true" ${location.active ? "selected" : ""}>Enabled</option><option value="false" ${!location.active ? "selected" : ""}>Deleted</option></select></td><td><div class="admin-row-actions"><button class="button small secondary" data-action="save-location" data-id="${location.id}">Save</button><button class="button small danger" data-action="delete-location" data-id="${location.id}" ${!location.active ? "disabled" : ""}>Delete</button></div></td></tr>`).join("");
    content = `<div class="admin-grid"><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">STOCK LOCATIONS</span><h2>Stores</h2><p>Edit store names or delete stores. Reassign active items and clear stock before deleting a store.</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>STORE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${locations}</tbody></table></div></section><section class="card admin-card"><div class="panel-heading"><div><span class="section-label">EXPAND YOUR STORES</span><h2>Add store</h2></div></div><form id="location-form" class="stack-form">${field("STORE NAME *", "name", "text", { required: true, minlength: 2, maxlength: 80, placeholder: "e.g. Annex Store" })}<button type="submit" class="button primary">Add store</button></form></section></div>`;
  } else if (state.adminSection === "Clear All") {
    content = `<section class="card admin-card reset-card"><div class="panel-heading"><div><span class="section-label">DESTRUCTIVE ADMIN ACTION</span><h2>Clear all system data</h2><p>This permanently removes inventory items, stock batches and movements, water records, custom inventory columns and values, custom stores/categories, requesters and historical audit entries. All user accounts remain.</p></div><span class="reset-warning">!</span></div><div class="reset-details"><strong>What remains</strong><p>The app's five standard stores, default categories and standard requester lists are restored so the system can be used again. Custom Gmail settings are cleared, and the reset itself is recorded in the audit log.</p></div><button type="button" class="button danger" data-action="clear-all">Clear All</button></section>`;
  } else {
    const auditRows = data.audit.map(entry => `<tr><td>${prettyDateTime(entry.created_at)}</td><td>${esc(entry.actor_name)}</td><td>${esc(entry.action)}</td><td>${esc(entry.detail)}</td></tr>`).join("");
    content = `<section class="card admin-card"><div class="panel-heading"><div><span class="section-label">SECURITY &amp; CHANGE HISTORY</span><h2>Administrative audit log</h2><p>Recent account, stock, and configuration actions.</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>DETAIL</th></tr></thead><tbody>${auditRows || `<tr><td colspan="4">No admin events yet.</td></tr>`}</tbody></table></div></section>`;
  }
  return `${pageHeading("ADMINISTRATION", "Admin console", "Manage accounts, requester lists, stock taxonomy, stores and audit history.")}<div class="section-tabs admin-tabs">${tabs}</div>${content}`;
}

function render(pageContent) {
  shell(pageContent);
}

async function navigate(page) {
  state.page = page;
  state.report = null;
  render(`<div class="loading-content"><span class="spinner"></span> Loading ${esc(page.toLowerCase())}…</div>`);
  try {
    if (page === "Dashboard") {
      render(renderDashboard(await api("/api/dashboard")));
    } else if (page === "Inventory") {
      state.inventorySection = "active";
      state.inventory = await api("/api/inventory");
      state.bootstrap.inventoryColumns = state.inventory.inventoryColumns || [];
      if (state.bootstrap.user.role === "admin") {
        state.archivedItems = (await api("/api/admin/archived-items")).items;
      }
      render(renderInventory(state.inventory));
    } else if (page === "Requests") {
      state.requests = await api("/api/requests");
      render(renderRequests(state.requests));
    } else if (page === "Stock issue") {
      if (state.bootstrap.user.role === "auditor") {
        await navigate("Auditor");
        return;
      }
      state.inventory = await api("/api/items");
      state.issueItems = [];
      render(renderIssue());
      updateIssueSummary();
      const locationSelect = document.querySelector('#stock-issue-form [name="locationId"]');
      if (locationSelect?.value) locationSelect.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (page === "Stock movements") {
      state.inventory = await api("/api/inventory");
      if (!state.movementFilters) state.movementFilters = { from: `${dateKey().slice(0, 8)}01`, to: dateKey(), category: "", kind: "" };
      render(renderMovements(await api(`/api/transactions?${new URLSearchParams(state.movementFilters)}`)));
    } else if (page === "Water") {
      state.water = await api("/api/water");
      render(renderWater(state.water));
    } else if (page === "Reports") {
      state.inventory = await api("/api/inventory");
      state.report = null;
      render(renderReports());
    } else if (page === "Admin") {
      if (state.bootstrap.user.role !== "admin") {
        await navigate("Dashboard");
        return;
      }
      state.inventory = await api("/api/inventory");
      render(renderAdmin(await api("/api/admin")));
    } else if (page === "Auditor") {
      if (!["admin", "auditor"].includes(state.bootstrap.user.role)) {
        await navigate("Dashboard");
        return;
      }
      state.auditor = await api("/api/auditor");
      render(renderAuditor(state.auditor));
    }
  } catch (error) {
    render(`<div class="error-state"><strong>Could not load ${esc(page.toLowerCase())}</strong><p>${esc(error.message)}</p><button class="button primary" data-action="retry">Try again</button></div>`);
  }
}

function showSetup() {
  app.innerHTML = `<div class="auth-screen"><section class="auth-card"><div class="auth-brand"><span class="brand-mark"><img src="/assets/capitol-catering-icon.png" alt="Capitol Catering"></span><div><strong>CAPITOL</strong><small>STOCK MANAGEMENT</small></div></div><span class="eyebrow">ONE-TIME SETUP</span><h1>Create your administrator</h1><p>This account controls stock, users, locations and water-record cleanup. Choose a unique password; there is no default login.</p><form id="setup-form">${field("ADMIN USERNAME *", "username", "text", { required: true, minlength: 3, maxlength: 40, autocomplete: "username", placeholder: "e.g. capitol.admin" })}${field("DISPLAY NAME *", "displayName", "text", { required: true, minlength: 2, maxlength: 80, autocomplete: "name", placeholder: "Your name" })}${passwordField(state.bootstrap.passwordPolicy === "strong" ? "PASSWORD *" : "4-DIGIT PASSWORD *", "password")}${passwordField("CONFIRM PASSWORD *", "confirmPassword") }<p class="auth-security">${esc(passwordPolicyDescription())}</p><button class="button primary auth-submit" type="submit">Create administrator →</button></form><small class="local-auth-note"><i></i> Only available before any user account exists.</small></section></div>`;
}

function showLogin() {
  const cloudMode = state.bootstrap?.passwordPolicy === "strong";
  app.innerHTML = `<div class="auth-screen"><section class="auth-card"><div class="auth-brand"><span class="brand-mark"><img src="/assets/capitol-catering-icon.png" alt="Capitol Catering"></span><div><strong>CAPITOL</strong><small>STOCK MANAGEMENT</small></div></div><span class="eyebrow">${cloudMode ? "SECURE CLOUD SIGN IN" : "LOCAL SIGN IN"}</span><h1>Welcome back</h1><p>${cloudMode ? "Sign in with your account. Imported PINs must be replaced with a strong password before access." : "Sign in to your local Capitol stock workspace."}</p><form id="login-form">${field("USERNAME", "username", "text", { required: true, autocomplete: "username" })}${field(cloudMode ? "CURRENT PASSWORD OR IMPORTED PIN" : "PASSWORD", "password", "password", { required: true, maxlength: 256, autocomplete: "current-password" })}<div id="new-cloud-password-slot"></div><button class="button primary auth-submit" type="submit">Sign in →</button></form><small class="local-auth-note"><i></i> ${cloudMode ? "Cloud passwords require at least 12 characters with uppercase and lowercase letters and a number." : "Existing passwords continue to work until reset. New and reset passwords use four digits."}</small></section></div>`;
}

async function initialize() {
  try {
    state.bootstrap = await api("/api/bootstrap");
    if (state.bootstrap.setupRequired) showSetup();
    else if (!state.bootstrap.user) showLogin();
    else await navigate("Dashboard");
  } catch (error) {
    app.innerHTML = `<section class="fatal-screen"><span>!</span><h1>App server unavailable</h1><p>${esc(error.message)}</p><button class="button primary" data-action="initialize">Retry connection</button></section>`;
  }
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setLoading(button, loading, text = "Working…") {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.innerHTML;
  button.disabled = loading;
  button.classList.toggle("is-loading", loading);
  button.innerHTML = loading ? `<span class="spinner"></span>${esc(text)}` : button.dataset.originalText;
}

async function withButtonLoading(button, text, action) {
  setLoading(button, true, text);
  try {
    return await action();
  } finally {
    if (button?.isConnected) setLoading(button, false);
  }
}

function selectedStockLines() {
  return [...document.querySelectorAll(".selected-line")].map(line => ({
    itemId: line.dataset.line,
    quantity: Number(line.querySelector("input").value),
    locationId: line.dataset.locationId,
  }));
}

function buildReportSpec(form) {
  const report = form.dataset.report;
  const type = form.querySelector(".report-period-selector button.active")?.dataset.reportType || "daily";
  const values = formValues(form);
  const spec = { report, type };
  if (report === "stock") {
    const reportKind = form.querySelector("[data-report-kind].active")?.dataset.reportKind || "requisition";
    spec.reportKind = reportKind;
    if (reportKind === "updates") {
      spec.store = values.updatesStore;
      return spec;
    }
    if (reportKind === "requisition") {
      spec.store = values.requisitionStore;
    }
  }
  if (type === "daily") spec.date = values.date;
  else if (type === "range") {
    spec.from = values.from;
    spec.to = values.to;
  } else if (values.month) spec.month = values.month;
  return spec;
}

function saveCsv(report) {
  const quote = value => {
    const text = String(value ?? "");
    const safeText = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  };
  const content = [report.headers, ...report.rows.map(row => report.headers.map(header => row[header]))]
    .map(row => row.map(quote).join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF", content, "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.type}-report-${report.from}-to-${report.to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function reloadAdmin() {
  const refreshed = await api("/api/bootstrap");
  state.bootstrap = { ...state.bootstrap, ...refreshed };
  state.admin = await api("/api/admin");
  render(renderAdmin(state.admin));
}

async function openInventoryAction(action, itemId = "") {
  if (state.bootstrap.user.role !== "admin") {
    toast("Only administrators can manage inventory.", true);
    return;
  }
  try {
    state.inventory = await api("/api/inventory");
    state.bootstrap.inventoryColumns = state.inventory.inventoryColumns || [];
    if (action === "new-item") {
      openModal(itemModal());
      return;
    }
    const item = state.inventory.items.find(entry => entry.id === itemId);
    if (!item) {
      toast("This inventory item is no longer available. Refresh the inventory and try again.", true);
      return;
    }
    if (action === "edit-item") openModal(itemModal(item));
    else openModal(stockModal(action, item));
  } catch (error) {
    toast(`Could not open the inventory form. ${error.message}`, true);
  }
}

document.addEventListener("click", async event => {
  const target = event.target.closest("button, a");
  if (!target) {
    if (event.target.classList?.contains("modal-backdrop")) closeModal();
    return;
  }
  if (target.dataset.storeToggle) {
    state.openStore = state.openStore === target.dataset.storeToggle ? "" : target.dataset.storeToggle;
    render(renderInventory(state.inventory));
    return;
  }
  if (target.dataset.requestStore) {
    state.openRequestStore = state.openRequestStore === target.dataset.requestStore ? "" : target.dataset.requestStore;
    render(renderRequests(state.requests));
    return;
  }
  if (["new-item", "edit-item", "receipt-item"].includes(target.dataset.action)) {
    event.preventDefault();
    await withButtonLoading(target, "Opening…", () => openInventoryAction(target.dataset.action, target.dataset.id || ""));
    return;
  }
  if (target.dataset.page) {
    event.preventDefault();
    if (target.dataset.page === "Water") state.waterSection = "Overview";
    await navigate(target.dataset.page);
    return;
  }
  if (target.dataset.waterSection) {
    state.waterSection = target.dataset.waterSection;
    if (state.waterSection === "Reports") state.report = null;
    render(renderWater(state.water));
    return;
  }
  if (target.dataset.adminSection) {
    state.adminSection = target.dataset.adminSection;
    await withButtonLoading(target, "Loading…", reloadAdmin);
    return;
  }
  if (target.dataset.reportType) {
    const form = target.closest("#report-form");
    if (!form) return;
    form.querySelectorAll(".report-period-selector button").forEach(button => button.classList.toggle("active", button === target));
    const reportKind = form.querySelector("[data-report-kind].active")?.dataset.reportKind || "";
    form.querySelectorAll("[data-report-period]").forEach(element => {
      element.hidden = reportKind === "updates" || element.dataset.reportPeriod !== target.dataset.reportType;
    });
  } else if (target.dataset.reportKind) {
    const form = target.closest("#report-form");
    if (!form) return;
    form.querySelectorAll("[data-report-kind]").forEach(button => button.classList.toggle("active", button === target));
    form.querySelectorAll("[data-report-period]").forEach(element => {
      element.hidden = target.dataset.reportKind === "updates" ||
        element.dataset.reportPeriod !== (form.querySelector(".report-period-selector button.active")?.dataset.reportType || "daily");
    });
    form.querySelectorAll("[data-report-kind-param]").forEach(element => {
      element.hidden = element.dataset.reportKindParam !== target.dataset.reportKind;
    });
    const label = target.textContent.trim().replace(" Report", "").replace(" Reports", "");
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.textContent = target.dataset.reportKind === "updates" ? "Generate stock updates →" : `Generate ${label} →`;
  }
  if (target.dataset.action === "logout") {
    setLoading(target, true, "Signing out…");
    try {
      await api("/api/logout", { method: "POST", body: {} });
      state.bootstrap.user = null;
      state.bootstrap.csrfToken = null;
      showLogin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "retry" || target.dataset.action === "initialize") {
    await initialize();
  } else if (target.dataset.action === "toggle-theme") {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("capitol-theme", state.theme);
    const pageContent = document.querySelector("#page-content")?.innerHTML || "";
    shell(pageContent);
  } else if (target.dataset.action === "go-issue") {
    await navigate("Stock issue");
  } else if (target.dataset.action === "show-archive") {
    setLoading(target, true, "Loading archive…");
    try {
      state.archivedItems = (await api("/api/admin/archived-items")).items;
      state.inventorySection = "archive";
      render(renderInventory(state.inventory));
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "show-active-items") {
    state.inventorySection = "active";
    try {
      state.inventory = await api("/api/inventory");
      render(renderInventory(state.inventory));
    } catch (error) { toast(error.message, true); }
  } else if (target.dataset.action === "delete-item") {
    const item = state.inventory.items.find(row => row.id === target.dataset.id);
    if (!item || !window.confirm(`Archive "${item.name}" from active inventory? It can be permanently deleted later from the Inventory archive.`)) return;
    setLoading(target, true, "Archiving item…");
    try {
      const result = await api(`/api/admin/items/${encodeURIComponent(item.id)}`, { method: "DELETE", body: {} });
      toast(result.archived ? "Item archived successfully." : "Item deleted successfully.");
      await navigate("Inventory");
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "permanently-delete-item") {
    const item = state.archivedItems.find(row => row.id === target.dataset.id);
    if (!item || !window.confirm(`Permanently delete "${item.name}" (SKU ${item.sku}) and all its stock batches and movement history? This cannot be undone, and the SKU will become available again.`)) return;
    setLoading(target, true, "Deleting permanently…");
    try {
      await api(`/api/admin/archived-items/${encodeURIComponent(item.id)}`, { method: "DELETE", body: {} });
      state.archivedItems = (await api("/api/admin/archived-items")).items;
      toast("Item and related stock history deleted successfully. Its SKU is available again.");
      render(renderInventory(state.inventory));
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "close-modal") {
    closeModal();
  } else if (target.dataset.action === "add-line") {
    try {
      const itemId = document.querySelector("#line-item").value;
      const quantity = Number(document.querySelector("#line-quantity").value);
      addIssueLine(itemId, quantity);
      document.querySelector("#line-item").value = "";
      document.querySelector("#line-quantity").value = "1";
    } catch (error) { toast(error.message, true); }
  } else if (target.dataset.action === "remove-line") {
    target.closest(".selected-line")?.remove();
    if (!document.querySelector(".selected-line")) document.querySelector("#issue-lines").innerHTML = `<div class="empty-lines">Select an item and add it to this requisition.</div>`;
    updateIssueSummary();
  } else if (target.dataset.action === "select-all-areas") {
    document.querySelectorAll('input[name="areas"]').forEach(input => { input.checked = true; });
  } else if (target.dataset.action === "filter-movements") {
    await withButtonLoading(target, "Loading…", applyMovementFilters);
  } else if (target.dataset.action === "export-movements") {
    if (state.transactions?.rows?.length) saveCsv({
      type: "stock-movements",
      from: state.movementFilters?.from || dateKey(),
      to: state.movementFilters?.to || dateKey(),
      headers: ["Date", "SKU", "Item", "Category", "Location", "Movement", "Quantity", "Unit", "Department", "Person", "Area", "Issued By", "Recorded By", "Voided", "Void reason", "Reversal of"],
      rows: state.transactions.rows.map(row => ({
        Date: row.request_date, SKU: row.item_sku, Item: row.item_name, Category: row.category,
        Location: row.location_name, Movement: row.kind, Quantity: row.quantity, Unit: row.unit,
        Department: row.department, Person: row.person, Area: row.area, "Issued By": row.issued_by, "Recorded By": row.created_by,
        Voided: row.voided_at ? "Yes" : "No", "Void reason": row.void_reason || "", "Reversal of": row.reversal_of || "",
      })),
    });
    else toast("There are no stock movements to export.", true);
  } else if (target.dataset.action === "water-issue") {
    state.waterSection = "Issue";
    await navigate("Water");
  } else if (target.dataset.action === "water-select-eligible") {
    document.querySelectorAll('input[name="waterRecipients"]:not(:disabled)').forEach(input => { input.checked = true; });
    updateWaterCount();
  } else if (target.dataset.action === "water-clear") {
    document.querySelectorAll('input[name="waterRecipients"]').forEach(input => { input.checked = false; });
    updateWaterCount();
  } else if (target.dataset.action === "water-delete") {
    await deleteWaterRecords(target);
  } else if (target.dataset.action === "edit-water-record") {
    const record = state.water.records.find(entry => entry.id === target.dataset.id);
    if (record && state.bootstrap.user.role === "admin") openModal(waterRecordModal(record));
  } else if (target.dataset.action === "edit-movement") {
    const movement = state.transactions?.rows.find(entry => entry.id === target.dataset.id);
    if (movement && state.bootstrap.user.role === "admin") openModal(movementModal(movement));
  } else if (target.dataset.action === "edit-request") {
    const request = state.requests?.rows.find(entry => entry.id === target.dataset.id);
    if (request && state.bootstrap.user.role === "admin") openModal(requestModal(request));
  } else if (target.dataset.action === "remove-request") {
    const request = state.requests?.rows.find(entry => entry.id === target.dataset.id);
    if (request && state.bootstrap.user.role === "admin") openModal(voidMovementModal(request, true));
  } else if (target.dataset.action === "void-movement") {
    const movement = state.transactions?.rows.find(entry => entry.id === target.dataset.id) ||
      state.requests?.rows.find(entry => entry.id === target.dataset.id);
    if (movement && state.bootstrap.user.role === "admin") openModal(voidMovementModal(movement));
  } else if (target.dataset.action === "download-report") {
    if (state.report) saveCsv(state.report);
  } else if (target.dataset.action === "show-email") {
    const form = document.querySelector("#report-email-form");
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector("input[name=\"to\"]").focus();
  } else if (target.dataset.action === "print-report") {
    if (state.report?.rows.length) window.print();
  } else if (target.dataset.action === "save-user") {
    await withButtonLoading(target, "Saving…", () => saveUser(target.dataset.id));
  } else if (target.dataset.action === "reset-user-password") {
    openModal(passwordModal(target.dataset.id));
  } else if (target.dataset.action === "toggle-user") {
    await withButtonLoading(target, "Saving…", () => saveUser(target.dataset.id));
  } else if (target.dataset.action === "delete-user") {
    const user = state.admin?.users.find(entry => entry.id === target.dataset.id);
    if (!user || !window.confirm(`Permanently delete the account for ${user.displayName}? Existing audit entries remain, but the account cannot sign in.`)) return;
    setLoading(target, true, "Deleting user…");
    try {
      await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE", body: {} });
      toast("User account deleted.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "clear-all") {
    if (!window.confirm("This permanently clears stock, requests, water history, custom inventory columns, stores/categories and audit history. All user accounts remain. Continue?")) return;
    const confirmation = window.prompt('Type "CLEAR ALL" to permanently reset the system.');
    if (confirmation !== "CLEAR ALL") {
      if (confirmation !== null) toast("Reset cancelled because the confirmation did not match.", true);
      return;
    }
    setLoading(target, true, "Clearing system…");
    try {
      const result = await api("/api/admin/reset", { method: "POST", body: { confirmation } });
      state.bootstrap = { ...state.bootstrap, ...await api("/api/bootstrap") };
      state.inventory = await api("/api/inventory");
      toast(`System cleared. ${result.counts.users} user accounts were retained.`);
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "save-requester") {
    const requester = state.admin?.requesters.find(entry => entry.id === target.dataset.id);
    if (!requester) return;
    setLoading(target, true, "Saving…");
    try {
      await api(`/api/admin/requesters/${encodeURIComponent(requester.id)}`, {
        method: "PUT",
        body: {
          name: document.querySelector(`[data-requester-name="${CSS.escape(requester.id)}"]`)?.value || requester.name,
          active: document.querySelector(`[data-requester-active="${CSS.escape(requester.id)}"]`)?.value !== "false",
        },
      });
      toast("Requester details updated.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "delete-requester") {
    if (!window.confirm("Delete this requester from active lists? Existing records retain the saved name.")) return;
    setLoading(target, true, "Deleting…");
    try {
      await api(`/api/admin/requesters/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE", body: {} });
      toast("Requester deleted.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "save-department") {
    const department = state.admin?.departments.find(entry => entry.id === target.dataset.id);
    if (!department) return;
    setLoading(target, true, "Saving…");
    try {
      await api(`/api/admin/departments/${encodeURIComponent(department.id)}`, {
        method: "PUT",
        body: { name: document.querySelector(`[data-department-name="${CSS.escape(department.id)}"]`)?.value || department.name },
      });
      toast("Department updated. Requester assignments were refreshed.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "delete-department") {
    const department = state.admin?.departments.find(entry => entry.id === target.dataset.id);
    if (!department || !window.confirm(`Delete "${department.name}" and remove its requester choices? Existing issue records will remain.`)) return;
    setLoading(target, true, "Deleting…");
    try {
      await api(`/api/admin/departments/${encodeURIComponent(department.id)}`, { method: "DELETE", body: {} });
      toast("Department deleted.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "save-housekeeping-area") {
    const area = state.admin?.housekeepingAreas.find(entry => entry.id === target.dataset.id);
    if (!area) return;
    setLoading(target, true, "Saving…");
    try {
      await api(`/api/admin/housekeeping-areas/${encodeURIComponent(area.id)}`, {
        method: "PUT",
        body: { name: document.querySelector(`[data-housekeeping-area-name="${CSS.escape(area.id)}"]`)?.value || area.name },
      });
      toast("Housekeeping area updated.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "delete-housekeeping-area") {
    const area = state.admin?.housekeepingAreas.find(entry => entry.id === target.dataset.id);
    if (!area || !window.confirm(`Delete "${area.name}" from Housekeeping area choices? Existing records remain saved.`)) return;
    setLoading(target, true, "Deleting…");
    try {
      await api(`/api/admin/housekeeping-areas/${encodeURIComponent(area.id)}`, { method: "DELETE", body: {} });
      toast("Housekeeping area deleted.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "save-category") {
    const category = state.admin?.categories.find(entry => entry.id === target.dataset.id);
    if (!category) return;
    setLoading(target, true, "Saving…");
    try {
      await api(`/api/admin/categories/${encodeURIComponent(category.id)}`, {
        method: "PUT",
        body: {
          name: document.querySelector(`[data-category-name="${CSS.escape(category.id)}"]`)?.value || category.name,
          active: document.querySelector(`[data-category-active="${CSS.escape(category.id)}"]`)?.value !== "false",
        },
      });
      toast("Category updated.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "delete-category") {
    if (!window.confirm("Delete this category? It cannot be removed while catalog items use it.")) return;
    setLoading(target, true, "Deleting…");
    try {
      await api(`/api/admin/categories/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE", body: {} });
      toast("Category deleted.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "save-inventory-column") {
    const column = state.admin?.inventoryColumns.find(entry => entry.id === target.dataset.id);
    if (!column) return;
    setLoading(target, true, "Saving…");
    try {
      await api(`/api/admin/inventory-columns/${encodeURIComponent(column.id)}`, {
        method: "PUT",
        body: {
          name: document.querySelector(`[data-inventory-column-name="${CSS.escape(column.id)}"]`)?.value || column.name,
          active: document.querySelector(`[data-inventory-column-active="${CSS.escape(column.id)}"]`)?.value !== "false",
        },
      });
      toast("Inventory column updated.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "delete-inventory-column") {
    const column = state.admin?.inventoryColumns.find(entry => entry.id === target.dataset.id);
    if (!column || !window.confirm(`Delete "${column.name}" and remove its saved values from all inventory items?`)) return;
    setLoading(target, true, "Deleting…");
    try {
      await api(`/api/admin/inventory-columns/${encodeURIComponent(column.id)}`, { method: "DELETE", body: {} });
      toast("Inventory column and its saved values deleted.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "save-location") {
    const location = state.admin?.locations.find(entry => entry.id === target.dataset.id);
    if (!location) return;
    setLoading(target, true, "Saving…");
    try {
      await api(`/api/admin/locations/${encodeURIComponent(location.id)}`, {
        method: "PUT",
        body: {
          name: document.querySelector(`[data-location-name="${CSS.escape(location.id)}"]`)?.value || location.name,
          active: document.querySelector(`[data-location-active="${CSS.escape(location.id)}"]`)?.value !== "false",
        },
      });
      toast("Store location updated.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  } else if (target.dataset.action === "delete-location") {
    if (!window.confirm("Delete this store from active inventory and issue locations? Its movement history remains available for audit.")) return;
    setLoading(target, true, "Deleting…");
    try {
      await api(`/api/admin/locations/${encodeURIComponent(target.dataset.id)}`, { method: "DELETE", body: {} });
      toast("Store deleted.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (target.isConnected) setLoading(target, false); }
  }
});

function openModal(html) {
  const root = document.querySelector("#modal-root");
  if (!root) return;
  root.innerHTML = html;
  root.querySelector(".modal")?.focus();
}

function closeModal() {
  const root = document.querySelector("#modal-root");
  if (root) root.innerHTML = "";
}

function passwordModal(userId) {
  const strong = state.bootstrap.passwordPolicy === "strong";
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal small-modal" role="dialog" aria-modal="true"><div class="modal-heading"><div><span class="section-label">ADMIN RESET</span><h2>Set a new ${strong ? "password" : "PIN"}</h2><p>${esc(passwordPolicyDescription())}</p></div><button type="button" class="modal-close" data-action="close-modal">×</button></div><form id="password-reset-form" data-user-id="${esc(userId)}">${passwordField(strong ? "NEW PASSWORD *" : "4-DIGIT PASSWORD *", "password")}<div class="modal-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Reset ${strong ? "password" : "PIN"}</button></div></form></section></div>`;
}

function updateWaterCount() {
  const count = document.querySelectorAll('input[name="waterRecipients"]:checked').length;
  const label = document.querySelector("#water-selected-count");
  if (label) label.textContent = String(count);
}

async function deleteWaterRecords(buttonElement) {
  const ids = [...document.querySelectorAll('input[name="waterRecordIds"]:checked')].map(input => input.value);
  if (!ids.length) return toast("Select one or more water records first.", true);
  if (!window.confirm(`Permanently remove ${ids.length} selected water record(s)? This updates the active tracker and history.`)) return;
  setLoading(buttonElement, true, "Deleting records…");
  try {
    const result = await api("/api/water/records", { method: "DELETE", body: { recordIds: ids } });
    state.water = result.snapshot;
    render(renderWater(state.water));
    toast(`${result.removed} water record(s) removed.`);
  } catch (error) { toast(error.message, true); }
  finally { if (buttonElement?.isConnected) setLoading(buttonElement, false); }
}

async function saveUser(userId) {
  const user = state.admin.users.find(entry => entry.id === userId);
  if (!user) return;
  const role = document.querySelector(`[data-user-role="${CSS.escape(userId)}"]`)?.value || user.role;
  const active = document.querySelector(`[data-user-active="${CSS.escape(userId)}"]`)?.value !== "false";
  try {
    await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: {
        displayName: document.querySelector(`[data-user-name="${CSS.escape(userId)}"]`)?.value || user.displayName,
        role,
        active,
      },
    });
    toast("User access updated.");
    await reloadAdmin();
  } catch (error) { toast(error.message, true); }
}

function collectReportFormData(form) {
  const spec = buildReportSpec(form);
  return spec;
}

document.addEventListener("change", async event => {
  if (event.target.matches('#stock-issue-form [name="department"]')) {
    const department = event.target.value;
    document.querySelector("#department-fields").innerHTML = renderDepartmentFields(department);
    updateIssueSummary();
  } else if (event.target.matches('#stock-issue-form [name="locationId"]')) {
    const itemSelect = document.querySelector('#stock-issue-form [name="line-item"]');
    const locationSelect = event.target;
    const selectedLocationId = locationSelect.value;
    if (itemSelect) {
      itemSelect.disabled = true;
      itemSelect.innerHTML = `<option value="">Loading this store's stock…</option>`;
      try {
        const stock = await api(`/api/items?locationId=${encodeURIComponent(selectedLocationId)}`);
        if (!locationSelect.isConnected || locationSelect.value !== selectedLocationId) return;
        state.issueItems = stock.items;
        itemSelect.innerHTML = itemSelectOptions(selectedLocationId)
          .map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`)
          .join("");
        if (!state.issueItems.length) toast("No available items in this store.", true);
      } catch (error) {
        if (!locationSelect.isConnected || locationSelect.value !== selectedLocationId) return;
        state.issueItems = [];
        itemSelect.innerHTML = `<option value="">Stock could not be loaded</option>`;
        toast(error.message, true);
      } finally {
        if (itemSelect.isConnected && locationSelect.isConnected && locationSelect.value === selectedLocationId) {
          itemSelect.disabled = false;
        }
      }
    }
    updateIssueSummary();
  } else if (event.target.matches('#item-form [name="store"]')) {
    const category = categoryForStore(event.target.value);
    const form = event.target.closest("#item-form");
    if (category) {
      const categorySelect = form?.querySelector('[name="category"]');
      if (categorySelect) categorySelect.value = category;
    }
    const location = state.inventory.locations.find(entry => entry.name.toLowerCase() === event.target.value.trim().toLowerCase());
    const locationSelect = form?.querySelector('[name="locationId"]');
    if (location && locationSelect) locationSelect.value = location.id;
  } else if (event.target.matches('input[name="waterRecipients"]')) {
    updateWaterCount();
  }
});

document.addEventListener("input", event => {
  if (event.target.id === "inventory-search" || event.target.id === "inventory-category") {
    if (state.page !== "Inventory") return;
    if (state.inventorySection === "archive") {
      render(renderInventory(state.inventory));
      const archiveSearch = document.querySelector("#inventory-search");
      archiveSearch?.focus();
      archiveSearch?.setSelectionRange(archiveSearch.value.length, archiveSearch.value.length);
      return;
    }
    const data = state.inventory;
    const query = document.querySelector("#inventory-search")?.value || "";
    const category = document.querySelector("#inventory-category")?.value || "";
    const filtered = { ...data, items: data.items.filter(item =>
      (!query || `${item.name} ${item.sku}`.toLowerCase().includes(query.toLowerCase())) &&
      (!category || item.category === category)) };
    const selection = document.querySelector("#inventory-category")?.value || "";
    render(renderInventory(filtered));
    const categorySelect = document.querySelector("#inventory-category");
    if (categorySelect) categorySelect.value = selection;
    document.querySelector("#inventory-search")?.focus();
    const search = document.querySelector("#inventory-search");
    if (search) search.setSelectionRange(search.value.length, search.value.length);
  } else if (event.target.matches('#item-form[data-item-id]:not([data-item-id=""]) [name="previousMonthQuantity"], #item-form[data-item-id]:not([data-item-id=""]) [name="receivedStockQuantity"]')) {
    const form = event.target.closest("#item-form");
    const previous = Math.max(0, Number(form.querySelector('[name="previousMonthQuantity"]').value) || 0);
    const received = Math.max(0, Number(form.querySelector('[name="receivedStockQuantity"]').value) || 0);
    const current = Math.round((previous + received) * 1000) / 1000;
    const removed = Number(form.querySelector("#stock-entry-removed").textContent.replace(/,/g, "")) || 0;
    const remainder = Math.max(0, current - removed);
    const percent = current > 0 ? Math.min(100, remainder / current * 100) : 0;
    const currentElement = form.querySelector("#stock-entry-current");
    const remainderElement = form.querySelector("#stock-entry-remainder");
    const status = form.querySelector("#stock-entry-status");
    if (currentElement) currentElement.textContent = number(current);
    if (remainderElement) remainderElement.textContent = number(remainder);
    if (status) {
      status.textContent = `${number(percent, 1)}%`;
      status.className = `pill ${percent >= 80 ? "good" : percent >= 20 && percent <= 70 ? "warning" : percent <= 10 ? "danger" : "neutral"}`;
    }
  } else if (event.target.matches('#item-form[data-item-id=""] [name="sku"], #item-form[data-item-id=""] [name="name"], #item-form[data-item-id=""] [name="previousMonthQuantity"], #item-form[data-item-id=""] [name="receivedStockQuantity"], #item-form[data-item-id=""] [name="initialQuantity"]')) {
    const form = event.target.closest("#item-form");
    const previousInput = form.querySelector('[name="previousMonthQuantity"]');
    const receivedInput = form.querySelector('[name="receivedStockQuantity"]');
    const currentInput = form.querySelector('[name="initialQuantity"]');
    const previous = Number(previousInput?.value || 0);
    let received = Number(receivedInput?.value || 0);
    let current = Number(currentInput?.value || 0);
    if (event.target === currentInput) {
      received = Math.max(0, Math.round((current - previous) * 1000) / 1000);
      if (receivedInput) receivedInput.value = String(received);
    } else {
      current = Math.round((previous + received) * 1000) / 1000;
      if (currentInput) currentInput.value = String(current);
    }
    const sku = form.querySelector('[name="sku"]').value.trim() || "—";
    const name = form.querySelector('[name="name"]').value.trim() || "—";
    const remainder = Math.max(0, current);
    const percent = current > 0 ? Math.min(100, remainder / current * 100) : 0;
    const status = document.querySelector("#stock-entry-status");
    document.querySelector("#stock-entry-sku").textContent = sku;
    document.querySelector("#stock-entry-name").textContent = name;
    document.querySelector("#stock-entry-removed").textContent = "0";
    document.querySelector("#stock-entry-remainder").textContent = number(remainder);
    if (status) {
      status.textContent = `${number(percent, 1)}%`;
      status.className = `pill ${percent >= 80 ? "good" : percent >= 20 && percent <= 70 ? "warning" : percent <= 10 ? "danger" : "neutral"}`;
    }
    if (currentInput) currentInput.setCustomValidity(current < previous ? "Current quantity cannot be less than previous month stock quantity." : "");
  } else if (event.target.id === "water-filter") {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll("#water-room-grid .water-status-card").forEach(card => {
      card.hidden = !card.querySelector("strong").textContent.toLowerCase().includes(query);
    });
  } else if (event.target.id === "water-search") {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll(".water-option[data-water-option]").forEach(option => {
      option.hidden = !option.dataset.name.includes(query);
    });
  } else if (event.target.matches(".selected-line input")) {
    const line = event.target.closest(".selected-line");
    const available = Number(line?.dataset.available || 0);
    if (Number(event.target.value) > available) {
      event.target.setCustomValidity(`Maximum available at this store: ${available}`);
    } else event.target.setCustomValidity("");
  }
});

document.addEventListener("submit", async event => {
  const form = event.target;
  event.preventDefault();
  if (form.id === "setup-form") {
    const values = formValues(form);
    if (values.password !== values.confirmPassword) return toast("Passwords do not match.", true);
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Creating admin…");
    try {
      await api("/api/setup", { method: "POST", body: values });
      toast("Administrator created. Sign in with your new account.");
      state.bootstrap = await api("/api/bootstrap");
      showLogin();
    } catch (error) { toast(error.message, true); }
    finally { setLoading(submit, false); }
  } else if (form.id === "login-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Signing in…");
    try {
      const result = await api("/api/login", { method: "POST", body: formValues(form) });
      if (result.passwordResetRequired) {
        form.querySelector("#new-cloud-password-slot").innerHTML = passwordField("NEW STRONG PASSWORD *", "newPassword");
        submit.dataset.originalText = "Update password and sign in →";
        form.querySelector("#newPassword")?.focus();
        toast("Your imported PIN is verified. Set a strong cloud password to continue.");
        return;
      }
      state.bootstrap.user = result.user;
      state.bootstrap.csrfToken = result.csrfToken;
      await navigate("Dashboard");
    } catch (error) { toast(error.message, true); }
    finally { setLoading(submit, false); }
  } else if (form.id === "item-form") {
    const values = formValues(form);
    values.customValues = Object.fromEntries(
      [...form.querySelectorAll("[data-custom-column]")].map(input => [input.dataset.customColumn, input.value]),
    );
    const id = form.dataset.itemId;
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, id ? "Saving item…" : "Creating item…");
    try {
      if (id) {
        await api(`/api/admin/items/${encodeURIComponent(id)}`, { method: "PUT", body: values });
        toast("Item saved successfully.");
      } else {
        await api("/api/admin/items", { method: "POST", body: values });
        toast("Item saved successfully.");
      }
      closeModal();
      await navigate("Inventory");
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "receipt-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Saving receipt…");
    try {
      const result = await api("/api/stock/receipt", { method: "POST", body: { ...formValues(form), itemId: form.dataset.itemId } });
      state.inventory = { ...state.inventory, items: result.inventory };
      closeModal();
      toast("Stock receipt saved and batch added.");
      await navigate("Inventory");
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "stock-issue-form") {
    const lines = selectedStockLines();
    if (!lines.length) return toast("Add at least one stock item to the requisition.", true);
    const body = {
      ...formValues(form),
      areas: [...form.querySelectorAll('input[name="areas"]:checked')].map(input => input.value),
      lines,
    };
    const submit = form.querySelector('[data-action="submit-stock"]');
    setLoading(submit, true, "Saving requisition…");
    try {
      const result = await api("/api/stock/issue", { method: "POST", body });
      toast(`Stock issue recorded (${result.lines} item lines).`);
      await navigate("Dashboard");
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "water-issue-form") {
    const recipients = [...form.querySelectorAll('input[name="waterRecipients"]:checked')].map(input => input.value);
    if (!recipients.length) return toast("Select at least one room or staff unit.", true);
    const exempt = recipients.filter(name => WATER_EXEMPT.has(name));
    if (exempt.length && !window.confirm(`${exempt.join(", ")} ${exempt.length === 1 ? "is" : "are"} exempt from cooldown. Confirm daily issuance?`)) return;
    const submit = form.querySelector('[data-action="submit-water"]');
    setLoading(submit, true, "Recording water issue…");
    try {
      const result = await api("/api/water/issue", { method: "POST", body: { ...formValues(form), recipients } });
      state.water = result.snapshot;
      state.waterSection = "Overview";
      render(renderWater(state.water));
      toast(`${result.issued.length} water recipient(s) recorded.`);
      if (result.skipped.length) toast(`Skipped in cooldown: ${result.skipped.map(item => `${item.recipient} (${item.remainingDays}d)`).join(", ")}`, true);
    } catch (error) {
      if (error.payload?.skipped?.length) toast(`${error.message} ${error.payload.skipped.map(item => item.recipient).join(", ")}`, true);
      else toast(error.message, true);
    } finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "report-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Generating report…");
    try {
      const spec = collectReportFormData(form);
      const report = await api("/api/reports", { method: "POST", body: spec });
      state.report = report;
      state.reportSpec = spec;
      const page = state.page === "Water" ? renderWater(state.water) : renderReports();
      render(page);
      if (!report.rows.length) toast("No records were found for that report period.", true);
      else toast(`Report generated: ${report.rows.length} rows.`);
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "report-email-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Sending report…");
    try {
      const result = await api("/api/reports/email", { method: "POST", body: { ...state.reportSpec, to: formValues(form).to } });
      toast(`Report emailed to ${result.to}.`);
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "user-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Creating account…");
    try {
      await api("/api/admin/users", { method: "POST", body: formValues(form) });
      toast("User account created.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "password-reset-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, state.bootstrap.passwordPolicy === "strong" ? "Resetting password…" : "Resetting PIN…");
    try {
      await api(`/api/admin/users/${encodeURIComponent(form.dataset.userId)}/password`, { method: "PUT", body: formValues(form) });
      closeModal();
      toast("Password has been reset.");
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "water-record-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Saving correction…");
    try {
      const result = await api(`/api/admin/water-records/${encodeURIComponent(form.dataset.recordId)}`, { method: "PUT", body: formValues(form) });
      state.water = result.snapshot;
      closeModal();
      toast("Water record corrected.");
      render(renderWater(state.water));
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "movement-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Saving correction…");
    try {
      await api(`/api/admin/transactions/${encodeURIComponent(form.dataset.movementId)}`, { method: "PUT", body: formValues(form) });
      closeModal();
      toast("Stock movement corrected; batch balance reconciled.");
      await applyMovementFilters();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "request-form") {
    const submit = form.querySelector('[type="submit"]');
    const values = formValues(form);
    setLoading(submit, true, "Saving correction…");
    try {
      await api(`/api/admin/requests/${encodeURIComponent(form.dataset.requestId)}`, {
        method: "PUT",
        body: values,
      });
      closeModal();
      toast("Request corrected; inventory and reports were updated.");
      await navigate("Requests");
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "void-request-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Removing request…");
    try {
      await api(`/api/admin/requests/${encodeURIComponent(form.dataset.requestId)}`, { method: "DELETE", body: formValues(form) });
      closeModal();
      toast("Request removed and stock restored; movement history is retained.");
      await navigate("Requests");
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "void-movement-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Reversing movement…");
    try {
      await api(`/api/admin/transactions/${encodeURIComponent(form.dataset.movementId)}`, { method: "DELETE", body: formValues(form) });
      closeModal();
      toast("Movement voided with an auditable reversal.");
      if (state.page === "Requests") await navigate("Requests");
      else await applyMovementFilters();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "mail-config-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Saving settings…");
    try {
      const result = await api("/api/admin/mail", { method: "POST", body: formValues(form) });
      state.bootstrap.gmailConfigured = result.configured;
      toast("Gmail sender is ready for this session.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "appearance-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Saving appearance…");
    try {
      const result = await api("/api/admin/appearance", { method: "PUT", body: formValues(form) });
      state.bootstrap.appearance = result.appearance;
      toast("Shared appearance settings saved.");
      render(renderAdmin(await api("/api/admin")));
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "location-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Adding store…");
    try {
      await api("/api/admin/locations", { method: "POST", body: formValues(form) });
      toast("Store location added.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "category-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Adding category…");
    try {
      await api("/api/admin/categories", { method: "POST", body: formValues(form) });
      toast("Category added.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "inventory-column-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Adding column…");
    try {
      await api("/api/admin/inventory-columns", { method: "POST", body: formValues(form) });
      toast("Inventory column added.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "requester-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Adding requester…");
    try {
      await api("/api/admin/requesters", { method: "POST", body: formValues(form) });
      toast("Requester added.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "department-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Adding department…");
    try {
      await api("/api/admin/departments", { method: "POST", body: formValues(form) });
      toast("Department added.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  } else if (form.id === "housekeeping-area-form") {
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Adding area…");
    try {
      await api("/api/admin/housekeeping-areas", { method: "POST", body: formValues(form) });
      toast("Housekeeping area added.");
      await reloadAdmin();
    } catch (error) { toast(error.message, true); }
    finally { if (submit.isConnected) setLoading(submit, false); }
  }
});

async function applyMovementFilters() {
  state.movementFilters = {
    from: document.querySelector("#movement-from")?.value || "",
    to: document.querySelector("#movement-to")?.value || "",
    category: document.querySelector("#movement-category")?.value || "",
    kind: document.querySelector("#movement-kind")?.value || "",
  };
  const query = new URLSearchParams(state.movementFilters);
  try { render(renderMovements(await api(`/api/transactions?${query}`))); }
  catch (error) { toast(error.message, true); }
}

initialize();
