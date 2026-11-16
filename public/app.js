import {
  PALETTE,
  THEME_STORAGE_KEY,
  applyTheme,
  assignProjectColors,
  loadTheme,
  normalizeColorOverrides,
  normalizePrefs,
  normalizeTheme,
  relativeTime,
  resolveColor,
  saveTheme,
  sortIssues,
  themeForKey,
} from "/logic.js";

// ---- Theme toggle (System / Light / Dark) ----
// The inline script in index.html already set data-theme before first paint; this keeps the
// radiogroup in sync, saves changes, and follows changes made in other tabs.
function themeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const themeButtons = [...document.querySelectorAll("[data-theme-choice]")];

function syncThemeButtons(theme) {
  for (const button of themeButtons) {
    const selected = button.dataset.themeChoice === theme;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

function chooseTheme(theme, { persist = true } = {}) {
  const clean = applyTheme(document.documentElement, theme);
  if (persist) saveTheme(themeStorage(), clean);
  syncThemeButtons(clean);
  return clean;
}

function initThemeToggle() {
  chooseTheme(loadTheme(themeStorage()), { persist: false });
  for (const button of themeButtons) {
    button.addEventListener("click", () => chooseTheme(button.dataset.themeChoice));
  }
  document.getElementById("theme-toggle")?.addEventListener("keydown", (event) => {
    const current = normalizeTheme(document.documentElement.getAttribute("data-theme"));
    const next = themeForKey(current, event.key);
    if (!next) return;
    event.preventDefault();
    chooseTheme(next);
    themeButtons.find((button) => button.dataset.themeChoice === next)?.focus();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      chooseTheme(loadTheme(themeStorage()), { persist: false });
    }
  });
}

initThemeToggle();

const PREF_KEY = "localJiraBoard.prefs.v1";
const COLOR_KEY = "localJiraBoard.projectColors.v1";

function loadColorOverrides() {
  try {
    return normalizeColorOverrides(JSON.parse(localStorage.getItem(COLOR_KEY) || "{}"));
  } catch {
    return {};
  }
}

function saveColorOverrides() {
  try {
    if (Object.keys(state.colorOverrides).length) {
      localStorage.setItem(COLOR_KEY, JSON.stringify(state.colorOverrides));
    } else {
      localStorage.removeItem(COLOR_KEY);
    }
  } catch {
    // Overrides just won't persist if localStorage is unavailable.
  }
}

function loadPrefs() {
  try {
    return normalizePrefs(JSON.parse(localStorage.getItem(PREF_KEY) || "{}"));
  } catch {
    return normalizePrefs({});
  }
}

function savePrefs() {
  try {
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({ sort: state.sort, assignedWindow: state.assignedWindow, recentOnly: state.recentOnly }),
    );
  } catch {
    // localStorage can be unavailable (private mode); preferences just won't persist.
  }
}

const CATEGORIES = [
  { key: "new", name: "To Do" },
  { key: "indeterminate", name: "In Progress" },
  { key: "done", name: "Done" },
];

const PRIORITY_OPTIONS = ["Highest", "High", "Medium", "Low", "Lowest"];

const state = {
  health: null,
  me: null,
  issues: [],
  includeDone: false,
  colorOverrides: loadColorOverrides(),
  colorMap: new Map(),
  ...(() => {
    const prefs = loadPrefs();
    return { sort: prefs.sort, assignedWindow: prefs.assignedWindow, recentOnly: prefs.recentOnly };
  })(),
  filters: {
    search: "",
    project: "",
    role: "both",
    type: "",
    priority: "",
    swimlanes: false,
  },
  selectedKey: null,
  selected: null,
  assigneeChoice: null,
  busy: false,
  draggingKey: null,
};

const els = {
  banner: document.getElementById("banner"),
  subtitle: document.getElementById("subtitle"),
  lastUpdated: document.getElementById("last-updated"),
  refresh: document.getElementById("refresh-btn"),
  board: document.getElementById("board"),
  search: document.getElementById("search"),
  projectChips: document.getElementById("project-chips"),
  resetColors: document.getElementById("reset-colors"),
  colorPop: document.getElementById("color-pop"),
  colorPopTitle: document.getElementById("color-pop-title"),
  colorSwatches: document.getElementById("color-swatches"),
  colorResetOne: document.getElementById("color-reset-one"),
  colorPopClose: document.getElementById("color-pop-close"),
  role: document.getElementById("filter-role"),
  type: document.getElementById("filter-type"),
  priority: document.getElementById("filter-priority"),
  includeDone: document.getElementById("include-done"),
  sort: document.getElementById("sort"),
  recentOnly: document.getElementById("recent-only"),
  assignedWindow: document.getElementById("assigned-window"),
  swimlanes: document.getElementById("swimlanes"),
  drawer: document.getElementById("drawer"),
  backdrop: document.getElementById("drawer-backdrop"),
  drawerKey: document.getElementById("drawer-key"),
  drawerClose: document.getElementById("drawer-close"),
  drawerMeta: document.getElementById("drawer-meta"),
  editSummary: document.getElementById("edit-summary"),
  editPriority: document.getElementById("edit-priority"),
  editAssignee: document.getElementById("edit-assignee"),
  assigneeResults: document.getElementById("assignee-results"),
  saveIssue: document.getElementById("save-issue"),
  commentList: document.getElementById("comment-list"),
  newComment: document.getElementById("new-comment"),
  addComment: document.getElementById("add-comment"),
  picker: document.getElementById("picker"),
  pickerCopy: document.getElementById("picker-copy"),
  pickerOptions: document.getElementById("picker-options"),
  pickerCancel: document.getElementById("picker-cancel"),
};

function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options = { ...options, body: JSON.stringify(options.body) };
  }
  return fetch(path, { ...options, headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.message || `Request failed (${res.status})`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  });
}

function toast(message, kind = "info") {
  const node = document.createElement("div");
  node.className = `toast ${kind === "error" ? "error" : ""}`;
  node.textContent = message;
  document.getElementById("toasts").append(node);
  setTimeout(() => node.remove(), 5000);
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function avatar(user) {
  const wrap = document.createElement("span");
  wrap.className = "avatar";
  if (user?.avatarUrl) {
    const img = document.createElement("img");
    img.src = user.avatarUrl;
    img.alt = "";
    wrap.append(img);
  } else {
    wrap.textContent = initials(user?.displayName);
  }
  return wrap;
}

function person(user, fallback = "Unassigned") {
  const node = document.createElement("span");
  node.className = "person";
  if (!user) {
    node.textContent = fallback;
    return node;
  }
  node.append(avatar(user), document.createTextNode(user.displayName));
  return node;
}

function fullTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isMine(user) {
  if (!user || !state.me) return false;
  return user.accountId && user.accountId === state.me.accountId;
}

function visibleIssues() {
  const q = state.filters.search.trim().toLowerCase();
  return sortIssues(state.issues, state.sort).filter((issue) => {
    if (state.filters.project && issue.project.key !== state.filters.project) return false;
    if (state.filters.type && issue.issueType.name !== state.filters.type) return false;
    if (state.filters.priority && issue.priority.name !== state.filters.priority) return false;
    if (state.filters.role === "assigned" && !isMine(issue.assignee)) return false;
    if (state.filters.role === "reported" && !isMine(issue.reporter)) return false;
    if (q) {
      const hay = [issue.key, issue.summary, issue.project.key, issue.project.name, issue.status.name]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function fillSelect(select, values, current, allLabel) {
  const keep = current || select.value;
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = allLabel;
  select.append(all);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
}

function recomputeColors() {
  const keys = state.issues.map((issue) => issue.project.key).filter(Boolean);
  state.colorMap = assignProjectColors(keys, state.colorOverrides);
}

// Sets the per-scheme CSS variables on an element so styles.css can follow prefers-color-scheme.
function paintProject(el, key) {
  const index = state.colorMap.get(String(key).toUpperCase()) ?? 0;
  paintIndex(el, index);
  el.classList.add("proj");
}

function paintIndex(el, index) {
  const light = resolveColor(index, "light");
  const dark = resolveColor(index, "dark");
  el.style.setProperty("--pc-light", light.stripe);
  el.style.setProperty("--pc-light-text", light.text);
  el.style.setProperty("--pc-dark", dark.stripe);
  el.style.setProperty("--pc-dark-text", dark.text);
}

function projectInfo() {
  const info = new Map();
  for (const issue of state.issues) {
    const key = issue.project.key;
    if (!key) continue;
    const entry = info.get(key) || { key, name: issue.project.name || key, count: 0 };
    entry.count += 1;
    info.set(key, entry);
  }
  return [...info.values()].sort((x, y) => x.key.localeCompare(y.key));
}

function renderProjectChips() {
  const projects = projectInfo();
  if (state.filters.project && !projects.some((p) => p.key === state.filters.project)) {
    state.filters.project = "";
  }
  els.projectChips.innerHTML = "";
  const all = document.createElement("span");
  all.className = `pchip pchip-all${state.filters.project ? "" : " active"}`;
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.textContent = "All";
  allBtn.setAttribute("aria-pressed", String(!state.filters.project));
  allBtn.addEventListener("click", () => setProjectFilter(""));
  all.append(allBtn);
  els.projectChips.append(all);

  for (const project of projects) {
    const chip = document.createElement("span");
    chip.className = `pchip${state.filters.project === project.key ? " active" : ""}`;
    paintProject(chip, project.key);

    const dotBtn = document.createElement("button");
    dotBtn.type = "button";
    dotBtn.className = "dot-btn";
    dotBtn.title = `Change the color for ${project.key}`;
    dotBtn.setAttribute("aria-label", `Change color for project ${project.key}`);
    const dot = document.createElement("span");
    dot.className = "dot";
    dotBtn.append(dot);
    dotBtn.addEventListener("click", (event) => openColorPop(project, dotBtn, event));

    const label = document.createElement("button");
    label.type = "button";
    label.title = `${project.name} (${project.count} tickets). Click to filter.`;
    label.setAttribute("aria-pressed", String(state.filters.project === project.key));
    label.append(document.createTextNode(project.key));
    const count = document.createElement("span");
    count.className = "count-inline";
    count.textContent = String(project.count);
    label.append(count);
    label.addEventListener("click", () => setProjectFilter(state.filters.project === project.key ? "" : project.key));

    chip.append(dotBtn, label);
    els.projectChips.append(chip);
  }
  els.resetColors.classList.toggle("hidden", Object.keys(state.colorOverrides).length === 0);
}

function setProjectFilter(key) {
  state.filters.project = key;
  renderProjectChips();
  renderBoard();
}

let colorPopProject = null;

function openColorPop(project, anchor, event) {
  event?.stopPropagation();
  colorPopProject = project.key;
  els.colorPopTitle.textContent = `Color for ${project.key} · ${project.name}`;
  els.colorSwatches.innerHTML = "";
  const current = state.colorMap.get(project.key.toUpperCase());
  PALETTE.forEach((entry, index) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch proj";
    paintIndex(swatch, index);
    swatch.title = entry.name;
    swatch.setAttribute("aria-label", entry.name);
    swatch.setAttribute("aria-pressed", String(index === current));
    swatch.addEventListener("click", () => {
      state.colorOverrides[project.key.toUpperCase()] = index;
      applyColorChange();
    });
    els.colorSwatches.append(swatch);
  });
  const rect = anchor.getBoundingClientRect();
  els.colorPop.classList.remove("hidden");
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - els.colorPop.offsetWidth - 8);
  els.colorPop.style.left = `${left}px`;
  els.colorPop.style.top = `${rect.bottom + 8}px`;
  els.colorSwatches.querySelector("button")?.focus();
}

function closeColorPop() {
  colorPopProject = null;
  els.colorPop.classList.add("hidden");
}

function applyColorChange() {
  saveColorOverrides();
  recomputeColors();
  renderProjectChips();
  renderBoard();
  closeColorPop();
}

function refreshFilterOptions() {
  recomputeColors();
  renderProjectChips();
  fillSelect(els.type, unique(state.issues.map((i) => i.issueType.name)), state.filters.type, "All types");
  fillSelect(els.priority, unique(state.issues.map((i) => i.priority.name)), state.filters.priority, "All priorities");
}

function cardElement(issue) {
  const card = document.createElement("article");
  card.className = "card";
  card.draggable = true;
  card.dataset.key = issue.key;
  card.dataset.category = issue.status.category;
  paintProject(card, issue.project.key);

  const top = document.createElement("div");
  top.className = "card-top";
  const key = document.createElement("a");
  key.className = "issue-key";
  key.href = issue.url;
  key.target = "_blank";
  key.rel = "noopener noreferrer";
  key.textContent = issue.key;
  key.addEventListener("click", (event) => event.stopPropagation());
  const priority = document.createElement("span");
  priority.className = `chip priority ${issue.priority.name || ""}`;
  priority.textContent = issue.priority.name || "None";
  top.append(key, priority);

  const badges = document.createElement("div");
  badges.className = "badges";
  if (issue.newToMe) {
    const fresh = document.createElement("span");
    fresh.className = "chip new";
    fresh.textContent = "new to me";
    badges.append(fresh);
    if (issue.assignedAt) {
      const assigned = document.createElement("span");
      assigned.className = "chip assigned";
      assigned.textContent = `assigned ${relativeTime(issue.assignedAt)}`;
      assigned.title = `Assigned to you ${fullTime(issue.assignedAt)}`;
      badges.append(assigned);
    }
  }

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = issue.summary;

  const mid = document.createElement("div");
  mid.className = "card-top";
  const type = document.createElement("span");
  type.className = "chip";
  type.textContent = issue.issueType.name;
  const badge = document.createElement("span");
  badge.className = "proj-badge";
  badge.textContent = issue.project.key;
  badge.title = issue.project.name || issue.project.key;
  const left = document.createElement("span");
  left.className = "card-left";
  left.style.cssText = "display:inline-flex;align-items:center;gap:6px;min-width:0";
  left.append(badge, type);
  const status = document.createElement("span");
  status.className = "chip";
  status.textContent = issue.status.name;
  mid.append(left, status);

  const foot = document.createElement("div");
  foot.className = "card-foot";
  const when = document.createElement("time");
  when.className = "when";
  when.dateTime = issue.updated || "";
  when.textContent = issue.updated ? `updated ${relativeTime(issue.updated)}` : "";
  when.title = issue.updated ? `Updated ${fullTime(issue.updated)}` : "";
  foot.append(person(issue.assignee), when);

  if (badges.childElementCount) card.append(top, badges, summary, mid, foot);
  else card.append(top, summary, mid, foot);
  card.addEventListener("click", () => openDrawer(issue.key));
  card.addEventListener("dragstart", (event) => {
    state.draggingKey = issue.key;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", issue.key);
  });
  card.addEventListener("dragend", () => {
    state.draggingKey = null;
    card.classList.remove("dragging");
    document.querySelectorAll(".column").forEach((col) => col.classList.remove("drag-over"));
  });
  return card;
}

function bindColumnDrop(column, category) {
  column.addEventListener("dragover", (event) => {
    event.preventDefault();
    column.classList.add("drag-over");
    event.dataTransfer.dropEffect = "move";
  });
  column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
  column.addEventListener("drop", async (event) => {
    event.preventDefault();
    column.classList.remove("drag-over");
    const key = event.dataTransfer.getData("text/plain") || state.draggingKey;
    if (!key) return;
    const issue = state.issues.find((item) => item.key === key);
    if (!issue || issue.status.category === category) return;
    await transitionIssue(issue, category);
  });
}

function renderColumn(container, category, issues) {
  const column = document.createElement("section");
  column.className = "column";
  column.dataset.category = category.key;
  const head = document.createElement("div");
  head.className = "column-head";
  const title = document.createElement("h2");
  title.textContent = category.name;
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(issues.length);
  head.append(title, count);
  const cards = document.createElement("div");
  cards.className = "cards";
  if (!issues.length) {
    const empty = document.createElement("p");
    empty.className = "empty-col";
    empty.textContent = "No tickets";
    cards.append(empty);
  } else {
    for (const issue of issues) cards.append(cardElement(issue));
  }
  column.append(head, cards);
  bindColumnDrop(column, category.key);
  container.append(column);
}

function renderBoard() {
  const issues = visibleIssues();
  els.board.innerHTML = "";
  els.board.classList.toggle("swimlane-mode", state.filters.swimlanes);
  if (!state.issues.length) {
    const empty = document.createElement("p");
    empty.className = "empty-board";
    empty.textContent = "No tickets loaded yet.";
    els.board.append(empty);
    return;
  }
  if (!issues.length) {
    const empty = document.createElement("p");
    empty.className = "empty-board";
    empty.textContent = "No tickets match the current filters.";
    els.board.append(empty);
    return;
  }
  if (state.filters.swimlanes) {
    const projects = unique(issues.map((issue) => issue.project.key));
    for (const key of projects) {
      const lane = document.createElement("section");
      const title = document.createElement("h2");
      title.className = "lane-title";
      const sample = issues.find((issue) => issue.project.key === key);
      paintProject(title, key);
      const laneBadge = document.createElement("span");
      laneBadge.className = "proj-badge";
      laneBadge.textContent = key;
      title.append(laneBadge, document.createTextNode(sample.project.name || key));
      const grid = document.createElement("div");
      grid.className = "lane-grid";
      for (const category of CATEGORIES) {
        renderColumn(
          grid,
          category,
          issues.filter((issue) => issue.project.key === key && issue.status.category === category.key),
        );
      }
      lane.append(title, grid);
      els.board.append(lane);
    }
    return;
  }
  for (const category of CATEGORIES) {
    renderColumn(
      els.board,
      category,
      issues.filter((issue) => issue.status.category === category.key),
    );
  }
}

async function loadAll({ silent = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  if (!silent) els.refresh.disabled = true;
  try {
    const params = new URLSearchParams({
      includeDone: state.includeDone ? "1" : "0",
      assignedWithin: state.assignedWindow,
      recentlyAssigned: state.recentOnly ? "1" : "0",
    });
    const data = await api(`/api/issues?${params}`);
    if (data.warning) toast(data.warning, "error");
    state.issues = data.issues || [];
    refreshFilterOptions();
    renderBoard();
    els.lastUpdated.textContent = `Updated ${formatTime(new Date().toISOString())} · ${state.issues.length} tickets`;
  } catch (err) {
    toast(err.message, "error");
  } finally {
    state.busy = false;
    els.refresh.disabled = false;
  }
}

function replaceIssue(issue) {
  const index = state.issues.findIndex((item) => item.key === issue.key);
  if (index >= 0) {
    const merged = { ...state.issues[index], ...issue };
    if (!isMine(merged.assignee)) {
      merged.newToMe = false;
      merged.assignedAt = null;
    }
    state.issues[index] = merged;
  }
  else state.issues.unshift(issue);
  renderBoard();
}

async function transitionIssue(issue, category) {
  const previous = { ...issue, status: { ...issue.status } };
  try {
    const { transitions } = await api(`/api/issues/${issue.key}/transitions`);
    const matches = transitions.filter((item) => item.to.category === category);
    const usable = matches.filter((item) => !item.requiredFields?.length && !item.hasScreen);
    const blocked = matches.filter((item) => item.requiredFields?.length || item.hasScreen);

    if (!matches.length) {
      toast(`No transition from ${issue.status.name} to ${labelFor(category)}.`, "error");
      return;
    }
    if (usable.length === 1 && blocked.length === 0) {
      await applyTransitionOptimistic(issue, usable[0], previous);
      return;
    }
    openPicker(issue, matches, previous, category);
  } catch (err) {
    toast(err.message, "error");
  }
}

function labelFor(category) {
  return CATEGORIES.find((item) => item.key === category)?.name || category;
}

async function applyTransitionOptimistic(issue, transition, previous) {
  issue.status = {
    name: transition.to.name,
    category: transition.to.category,
    categoryName: transition.to.categoryName,
  };
  issue.updated = new Date().toISOString();
  replaceIssue(issue);
  try {
    const result = await api(`/api/issues/${issue.key}/transitions`, {
      method: "POST",
      body: { transitionId: transition.id },
    });
    if (result.issue) replaceIssue(result.issue);
  } catch (err) {
    replaceIssue(previous);
    toast(err.message, "error");
  }
}

function openPicker(issue, transitions, previous, category) {
  els.pickerCopy.textContent = `Multiple ways to move ${issue.key} to ${labelFor(category)}. Pick one, or open the ticket in Jira if extra fields are required.`;
  els.pickerOptions.innerHTML = "";
  for (const transition of transitions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    const needs = transition.requiredFields?.length || transition.hasScreen;
    button.textContent = needs
      ? `${transition.name} (needs extra fields in Jira)`
      : transition.name;
    button.disabled = Boolean(needs);
    button.addEventListener("click", async () => {
      closePicker();
      await applyTransitionOptimistic(issue, transition, previous);
    });
    els.pickerOptions.append(button);
  }
  els.picker.classList.remove("hidden");
}

function closePicker() {
  els.picker.classList.add("hidden");
  els.pickerOptions.innerHTML = "";
}

async function openDrawer(key) {
  state.selectedKey = key;
  try {
    const { issue } = await api(`/api/issues/${key}`);
    state.selected = issue;
    state.assigneeChoice = issue.assignee;
    els.drawerKey.textContent = issue.key;
    els.drawerKey.href = issue.url;
    els.editSummary.value = issue.summary;
    els.editPriority.innerHTML = "";
    const names = unique([...PRIORITY_OPTIONS, issue.priority.name]);
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      if (name === issue.priority.name) option.selected = true;
      els.editPriority.append(option);
    }
    els.editAssignee.value = issue.assignee?.displayName || "";
    els.assigneeResults.classList.add("hidden");
    els.drawerMeta.textContent = `${issue.issueType.name} · ${issue.status.name} · ${issue.project.name} · updated ${formatTime(issue.updated)}`;
    renderComments(issue.comments || []);
    els.drawer.classList.remove("hidden");
    els.backdrop.classList.remove("hidden");
    els.drawer.setAttribute("aria-hidden", "false");
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderComments(comments) {
  els.commentList.innerHTML = "";
  if (!comments.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No comments yet.";
    els.commentList.append(empty);
    return;
  }
  for (const comment of comments) {
    const node = document.createElement("div");
    node.className = "comment";
    const head = document.createElement("div");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = comment.author?.displayName || "Unknown";
    const when = document.createElement("span");
    when.className = "muted";
    when.textContent = formatTime(comment.created);
    head.append(who, when);
    const body = document.createElement("p");
    body.textContent = comment.body;
    node.append(head, body);
    els.commentList.append(node);
  }
}

function closeDrawer() {
  state.selectedKey = null;
  state.selected = null;
  els.drawer.classList.add("hidden");
  els.backdrop.classList.add("hidden");
  els.drawer.setAttribute("aria-hidden", "true");
  els.assigneeResults.classList.add("hidden");
}

async function saveIssue() {
  if (!state.selected) return;
  const key = state.selected.key;
  const previous = { ...state.selected };
  const body = {
    summary: els.editSummary.value,
    priority: els.editPriority.value,
    assigneeAccountId: state.assigneeChoice ? state.assigneeChoice.accountId : null,
  };
  const optimistic = {
    ...state.selected,
    summary: body.summary,
    priority: { ...state.selected.priority, name: body.priority },
    assignee: state.assigneeChoice,
  };
  replaceIssue(optimistic);
  els.saveIssue.disabled = true;
  try {
    const result = await api(`/api/issues/${key}`, { method: "PUT", body });
    if (result.issue) {
      replaceIssue(result.issue);
      if (state.selectedKey === key) {
        state.selected = { ...state.selected, ...result.issue };
        els.drawerMeta.textContent = `${result.issue.issueType.name} · ${result.issue.status.name} · ${result.issue.project.name} · updated ${formatTime(result.issue.updated)}`;
      }
    }
    toast("Saved.");
  } catch (err) {
    replaceIssue(previous);
    toast(err.message, "error");
  } finally {
    els.saveIssue.disabled = false;
  }
}

async function addComment() {
  if (!state.selected) return;
  const body = els.newComment.value.trim();
  if (!body) return;
  const key = state.selected.key;
  els.addComment.disabled = true;
  try {
    const result = await api(`/api/issues/${key}/comments`, { method: "POST", body: { body } });
    els.newComment.value = "";
    const comments = [...(state.selected.comments || []), result.comment];
    state.selected.comments = comments;
    renderComments(comments);
    toast("Comment added.");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    els.addComment.disabled = false;
  }
}

let searchTimer;
els.editAssignee.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = els.editAssignee.value.trim();
  if (!query) {
    state.assigneeChoice = null;
    els.assigneeResults.classList.add("hidden");
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({
        query,
        project: state.selected?.project.key || "",
        issueKey: state.selected?.key || "",
      });
      const { users } = await api(`/api/users/assignable?${params}`);
      els.assigneeResults.innerHTML = "";
      if (!users.length) {
        els.assigneeResults.classList.add("hidden");
        return;
      }
      for (const user of users) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = user.displayName;
        button.addEventListener("click", () => {
          state.assigneeChoice = user;
          els.editAssignee.value = user.displayName;
          els.assigneeResults.classList.add("hidden");
        });
        els.assigneeResults.append(button);
      }
      els.assigneeResults.classList.remove("hidden");
    } catch (err) {
      toast(err.message, "error");
    }
  }, 200);
});

function syncFiltersFromUi() {
  state.filters.search = els.search.value;
  state.filters.role = els.role.value;
  state.filters.type = els.type.value;
  state.filters.priority = els.priority.value;
  state.filters.swimlanes = els.swimlanes.checked;
  renderBoard();
}

els.search.addEventListener("input", syncFiltersFromUi);
els.resetColors.addEventListener("click", () => {
  state.colorOverrides = {};
  applyColorChange();
});
els.colorResetOne.addEventListener("click", () => {
  if (colorPopProject) delete state.colorOverrides[colorPopProject.toUpperCase()];
  applyColorChange();
});
els.colorPopClose.addEventListener("click", closeColorPop);
document.addEventListener("click", (event) => {
  if (!els.colorPop.classList.contains("hidden") && !els.colorPop.contains(event.target)) closeColorPop();
});
els.role.addEventListener("change", syncFiltersFromUi);
els.type.addEventListener("change", syncFiltersFromUi);
els.priority.addEventListener("change", syncFiltersFromUi);
els.swimlanes.addEventListener("change", syncFiltersFromUi);
els.sort.addEventListener("change", () => {
  state.sort = els.sort.value;
  savePrefs();
  renderBoard();
});
els.recentOnly.addEventListener("change", async () => {
  state.recentOnly = els.recentOnly.checked;
  savePrefs();
  await loadAll();
});
els.assignedWindow.addEventListener("change", async () => {
  state.assignedWindow = els.assignedWindow.value;
  savePrefs();
  await loadAll();
});
els.includeDone.addEventListener("change", async () => {
  state.includeDone = els.includeDone.checked;
  await loadAll();
});
els.refresh.addEventListener("click", () => loadAll());
els.drawerClose.addEventListener("click", closeDrawer);
els.backdrop.addEventListener("click", closeDrawer);
els.saveIssue.addEventListener("click", saveIssue);
els.addComment.addEventListener("click", addComment);
els.pickerCancel.addEventListener("click", closePicker);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeColorPop();
    closePicker();
    closeDrawer();
  }
});

async function boot() {
  els.sort.value = state.sort;
  els.recentOnly.checked = state.recentOnly;
  els.assignedWindow.value = state.assignedWindow;
  try {
    const [health, me] = await Promise.all([api("/api/health"), api("/api/me")]);
    state.health = health;
    state.me = me.user;
    els.subtitle.textContent = health.mode === "live"
      ? `Tickets assigned to or reported by ${me.user?.displayName || health.email}`
      : "Demo data — connect a Jira API token to load your tickets";
    if (health.setupNeeded || health.mode === "mock") {
      els.banner.classList.remove("hidden");
      if (health.setupNeeded) {
        els.banner.textContent = "";
        els.banner.append(
          document.createTextNode(
            `Running in demo mode because ${(health.setupMissing || []).join(", ") || "Jira settings"} ${(health.setupMissing || []).length === 1 ? "is" : "are"} not set. Create a token at `,
          ),
        );
        const link = document.createElement("a");
        link.href = "https://id.atlassian.com/manage-profile/tokens";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "id.atlassian.com → Security → API tokens";
        els.banner.append(link, document.createTextNode(", copy .env.example to .env, fill in the three JIRA_ values, then restart the server."));
      } else {
        els.banner.textContent = "Demo mode is on (MOCK=1). These tickets are fake sample data; nothing is written to Jira.";
      }
    }
  } catch (err) {
    els.banner.classList.remove("hidden");
    els.banner.textContent = err.message;
  }
  await loadAll();
  // Keep "updated Xh ago" labels fresh between data refreshes.
  setInterval(() => {
    if (state.draggingKey || !els.drawer.classList.contains("hidden") || !els.picker.classList.contains("hidden")) {
      return;
    }
    renderBoard();
  }, 60000);
  const interval = state.health?.autoRefreshMs || 180000;
  setInterval(() => {
    if (state.draggingKey || !els.drawer.classList.contains("hidden") || !els.picker.classList.contains("hidden")) {
      return;
    }
    loadAll({ silent: true });
  }, interval);
}

boot();
