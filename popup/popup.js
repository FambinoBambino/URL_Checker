/**
 * popup.js — Main script for the extension popup.
 *
 * This file handles:
 *   1. Tab switching (Folders tab / Image tab)
 *   2. Folder CRUD (create, read, delete) with persistence via browser.storage.local
 *   3. URL rendering — displaying stored URLs in the main panel
 *   4. Search — filtering stored URLs by substring match
 *   5. Light/dark mode toggle
 *   6. Storage change listener — auto-refreshes if URLs are saved via the context menu
 *
 * DATA MODEL (stored in browser.storage.local under key "folderData"):
 *   {
 *     folders: [
 *       {
 *         id: "f-1234567890",
 *         name: "Recipes",
 *         urls: [
 *           { link: "https://...", scanData: VirusTotal JSON or null },
 *         ],
 *       },
 *     ]
 *   }
 *
 * scanData is persisted after each scan so verdict colors and dropdown
 * stats survive popup close and browser restart without re-calling the API.
 */

/* ==========================================================================
   DOM REFERENCES
   We grab references to all the HTML elements we need to read from
   or write to. This is done once at the top so we don't have to
   repeatedly call document.getElementById() throughout the code.
   ========================================================================== */
const tabButtons = document.querySelectorAll(".tab-btn");
const panelFolders = document.getElementById("panel-folders");
const panelURL_Check = document.getElementById("panel-URL-Check");
const searchInput = document.getElementById("search-input");
const searchResultsEl = document.getElementById("search-results");
const btnTheme = document.getElementById("btn-theme");
const iconMoon = document.getElementById("icon-moon");
const iconSun = document.getElementById("icon-sun");
const btnHelp = document.getElementById("btn-help");
const btnSettings = document.getElementById("btn-settings");
const folderSidebarList = document.getElementById("folder-sidebar-list");
const newFolderInput = document.getElementById("new-folder-input");
const btnNewFolder = document.getElementById("btn-new-folder");
const folderHeaderTabs = document.getElementById("folder-header-tabs");
const urlListEl = document.getElementById("url-list");
const emptyFolderMsg = document.getElementById("empty-folder-msg");
const btnURL_Check = document.getElementById("btn-submit-url-check");
const urlInput = document.getElementById("single-use-url-check");

const scanResultCard = document.getElementById("scan-result-card");
const scanVerdictBadge = document.getElementById("scan-verdict-badge"); // Initially hidden
const scanResultStatus = document.getElementById("scan-result-status");
const btnOpenVT = document.getElementById("btn-open-vt"); // Initially hidden
// const scanResultDetails = document.getElementById("scan-result-details"); // Initially hidden
const statMalicious = document.getElementById("stat-malicious");
const statSuspicious = document.getElementById("stat-suspicious");
const statUndetected = document.getElementById("stat-undetected");
const statHarmless = document.getElementById("stat-harmless");
const statTimeout = document.getElementById("stat-timeout");
const toastContainer = document.getElementById("toast-container");
//classList.add() or classList.remove() can be used to show/hide elements by toggling the "hidden" class.
// textContent can be used to update the text inside an element, e.g., scanResultStatus.textContent = "New status text".
// href can be used to set the URL for a link, e.g., btnOpenVT.href = "https://www.virustotal.com/gui/url/...";

/* ==========================================================================
   TOAST NOTIFICATIONS
   showToast() creates a temporary message at the bottom of the popup.

   @param {string} title   — Bold headline text (e.g. "No API Key Set")
   @param {string} message — Body text; can contain an <a> tag for a link
   @param {"error"|"warning"|"info"} type — Controls the color scheme
   @param {number} duration — Milliseconds before auto-dismiss (0 = manual only)
   ========================================================================== */
function showToast(title, message, type = "error", duration = 6000) {
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  // Icon varies by type
  const icons = { error: "⚠", warning: "⚡", info: "ℹ" };
  const icon = icons[type] ?? "ℹ";

  const iconSpan = document.createElement("span");
  iconSpan.className = "toast-icon";
  iconSpan.textContent = icon;

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "toast-body";

  const titleSpan = document.createElement("span");
  titleSpan.className = "toast-title";
  titleSpan.textContent = title;

  const messageSpan = document.createElement("span");
  messageSpan.className = "toast-message";
  if (typeof message === "string" && message.includes("<a")) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(message, "text/html");
    messageSpan.append(...doc.body.childNodes);
  } else {
    messageSpan.textContent = message;
  }

  bodyDiv.appendChild(titleSpan);
  bodyDiv.appendChild(messageSpan);

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.title = "Dismiss";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => toast.remove());

  toast.appendChild(iconSpan);
  toast.appendChild(bodyDiv);
  toast.appendChild(closeBtn);

  toastContainer.appendChild(toast);

  // Auto-dismiss after `duration` ms (unless duration is 0)
  if (duration > 0) {
    setTimeout(() => toast.remove(), duration);
  }
}

// Listen for background toast messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "showToast") {
    showToast(message.title, message.message, message.type, message.duration);
    sendResponse({ received: true });
    return true;
  }
});

/* ==========================================================================
   API KEY GUARD
   getApiKey() reads the stored VirusTotal API key.
   If no key has been saved yet, it fires a toast explaining the problem
   and returns null — callers should check for null and abort the scan.
   ========================================================================== */
async function getApiKey() {
  const apiKey = (await browser.storage.local.get("virusTotalApiKey")).virusTotalApiKey ?? "";
  if (!apiKey) {
    showToast(
      "No API Key Set",
      `A VirusTotal API key is required to scan URLs. ` +
      `<a href="#" id="toast-open-settings">Open Settings</a> to add your key, ` +
      `or <a href="https://docs.virustotal.com/docs/please-give-me-an-api-key" target="_blank" rel="noopener noreferrer">get a free key here</a>.`,
      "error",
      0 // stays until dismissed, because action is required
    );
    // Wire the inline "Open Settings" link inside the toast
    const settingsLink = toastContainer.querySelector("#toast-open-settings");
    if (settingsLink) {
      settingsLink.addEventListener("click", (e) => {
        e.preventDefault();
        browser.runtime.openOptionsPage();
      });
    }
    return null;
  }
  return apiKey;
}

/* ==========================================================================
   STATE
   We keep a small amount of "in-memory state" so the popup can respond
   quickly to user actions without hitting storage on every click.
   This state is re-populated from storage every time the popup opens.
   ========================================================================== */

let activeFolderId = null;

// Current URL filter for folder view: "all", "green", "yellow", or "red"
let currentFolderFilter = "all";

// The full folder data object loaded from storage.
// This is kept in sync with storage via loadFolderData() and saveFolderData().
let folderData = { folders: [] };

/* ==========================================================================
   INITIALISATION
   Called once when the popup opens. Loads data from storage and renders
   the initial UI state.
   ========================================================================== */
async function init() {
  await loadFolderData();
  await restoreThemeState();
  await restoreActiveTab();
  setupFilterTabListeners();
  renderSidebar();
  renderUrlList();

  const { latestSingleScanResult } = await browser.storage.local.get("latestSingleScanResult");
  if (latestSingleScanResult) {
    urlInput.value = latestSingleScanResult.urlLink || "";
    updateScanResultsUI(latestSingleScanResult.statsData, latestSingleScanResult.urlId);
  }

  const { activeScanStatus } = await browser.storage.local.get("activeScanStatus");
  if (activeScanStatus && activeScanStatus.isScanning) {
    showToast(
      activeScanStatus.title || "Scan in Progress",
      activeScanStatus.message || "A scan is currently processing in the background...",
      activeScanStatus.type || "info",
      activeScanStatus.duration || 6000
    );
  }
}

/**
 * Attach click listeners to the folder filter header tabs (All, Green, Yellow, Red).
 */
function setupFilterTabListeners() {
  if (!folderHeaderTabs) return;
  const tabBtns = folderHeaderTabs.querySelectorAll(".folder-tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      currentFolderFilter = e.currentTarget.dataset.filter;
      tabBtns.forEach((b) => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      renderUrlList();
    });
  });
}

/* ==========================================================================
   STORAGE — READ & WRITE
   ========================================================================== */

/**
 * Load folder data from browser.storage.local into the in-memory variable.
 *
 * browser.storage.local.get("folderData") returns an object like:
 *   { folderData: { folders: [...] } }
 *
 * We destructure it to pull out the folderData value directly.
 * If the key doesn't exist yet (fresh install), we default to an empty array.
 */
async function loadFolderData() {
  try {
    const result = await browser.storage.local.get(["folderData", "activeFolderId"]);
    folderData = result.folderData || { folders: [] };
    activeFolderId = result.activeFolderId ?? null;

    if (activeFolderId && !folderData.folders.some((f) => f.id === activeFolderId)) {
      activeFolderId = folderData.folders[0]?.id ?? null;
    }
  } catch (err) {
    console.error("[popup] Failed to load folder data:", err);
    folderData = { folders: [] };
  }
}

/**
 * Save the in-memory folderData object back to browser.storage.local.
 *
 * browser.storage.local.set() takes an object of key-value pairs.
 * Passing { folderData } is shorthand for { folderData: folderData }
 * (a JavaScript feature called "shorthand property names").
 */
async function saveFolderData() {
  try {
    await browser.storage.local.set({ folderData });
  } catch (err) {
    console.error("[popup] Failed to save folder data:", err);
  }
}

async function persistStatsDataForUrl(link, statsData) {
  const folder = folderData.folders.find((f) => f.id === activeFolderId);
  if (!folder) return;

  const entry = folder.urls.find((e) => e.link === link);
  if (entry) {
    entry.statsData = statsData;
    entry.lastScanTime = Date.now(); // Store the current timestamp
    await saveFolderData();
  }
}

async function saveActiveTab(tabId) {
  try {
    await browser.storage.local.set({ activeTab: tabId });
  } catch (err) {
    console.error("[popup] Failed to save active tab:", err);
  }
}

async function restoreActiveTab() {
  try {
    const { activeTab } = await browser.storage.local.get("activeTab");
    const tabId = activeTab || "folders";

    tabButtons.forEach((b) => b.classList.remove("active"));
    Object.values(panels).forEach((p) => p.classList.remove("active"));

    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const panel = panels[tabId];
    if (btn && panel) {
      btn.classList.add("active");
      panel.classList.add("active");
      return;
    }

    document.querySelector('.tab-btn[data-tab="folders"]')?.classList.add("active");
    panelFolders.classList.add("active");
  } catch (err) {
    console.error("[popup] Failed to restore active tab:", err);
  }
}

/**
 * Save the current theme state (light/dark mode) to storage.
 *
 * This is called whenever the user cycles the toggles light/dark
 * mode, so the popup can restore the exact same appearance next time it opens.
 *
 * We store one value:
 *   isDarkMode       → boolean: is the popup currently in light mode?
 */
async function saveThemeState() {
  try {
    const isDark = document.body.classList.contains("dark-mode");
    await browser.storage.local.set({
      themeState: {
        isDarkMode: isDark
      },
    });
  } catch (err) {
    console.error("[popup] Failed to save theme state:", err);
  }
}

/**
 * Restore the saved theme state from storage and apply it.
 *
 * Called once during init(). If no saved state exists (fresh install),
 * everything stays at the defaults (dark mode, palette index 0).
 */
async function restoreThemeState() {
  try {
    const result = await browser.storage.local.get("themeState");
    const state = result.themeState;

    // Restore light/dark mode
    if (state.isDarkMode) {
      document.body.classList.add("dark-mode");
      iconMoon.classList.remove("hidden");
      iconSun.classList.add("hidden");
    }
    else {
      iconSun.classList.remove("hidden");
      iconMoon.classList.add("hidden");
    }
  }
  catch (err) {
    if (err instanceof TypeError) {// This is for fresh installs
      iconSun.classList.remove("hidden");
      iconMoon.classList.add("hidden");
    }
    else {
      console.error("[popup] Failed to restore theme state:", err);
    }
  }
}

/* ==========================================================================
   SIDEBAR — RENDER & INTERACT
   ========================================================================== */

/**
 * Renders the folder sidebar by creating a button for each stored folder.
 *
 * This function clears the sidebar and rebuilds it from scratch every time
 * it's called. This is a simple and reliable approach called "full re-render".
 * For a small number of folders (dozens), this is very fast. For thousands,
 * you'd want a more surgical DOM update approach, but that's overkill here.
 */
function renderSidebar() {
  // Clear all existing folder items from the sidebar.
  // innerHTML = "" removes all child elements at once.
  folderSidebarList.innerHTML = "";

  // Update the "active" state on the General folder button.
  // classList.toggle(class, force) adds the class if force is true,
  // removes it if force is false.

  // Create a button for each user-created folder
  folderData.folders.forEach((folder) => {
    // Create the outer container <button> for the folder row
    const btn = document.createElement("button");
    btn.className = "folder-item";
    // dataset.folderId maps to the HTML attribute data-folder-id
    btn.dataset.folderId = folder.id;

    // Mark the button as "active" if this folder is currently selected
    if (folder.id === activeFolderId) {
      btn.classList.add("active");
    }

    // ── Folder icon ──
    const iconSpan = document.createElement("span");
    iconSpan.className = "folder-item-icon";
    iconSpan.innerHTML = `<img src="../icons/folder/tabler--folder-16.png" alt="">`;

    // ── Folder name ──
    const nameSpan = document.createElement("span");
    nameSpan.className = "folder-item-name";
    nameSpan.textContent = folder.name;
    // .title sets the tooltip text shown on hover — useful for seeing
    // the full name when it's truncated with "…"
    nameSpan.title = folder.name;

    // ── Delete button ──
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "folder-delete-btn";
    deleteBtn.innerHTML = `<img src="../icons/delete/tabler--circle-x-filled-32.png" class="folder-delete-icon" alt="Delete">`;
    deleteBtn.title = "Delete folder";

    // e.stopPropagation() prevents the click from bubbling up to the
    // parent <button>. Without this, clicking delete would ALSO trigger
    // the folder selection click handler on the parent.
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteFolder(folder.id);
    });

    // ── Assemble the folder button ──
    // appendChild() adds each child to the button in order:
    // icon, then name, then delete button (left to right).
    btn.appendChild(iconSpan);
    btn.appendChild(nameSpan);
    btn.appendChild(deleteBtn);

    // Clicking the folder button (not the delete btn) selects this folder
    btn.addEventListener("click", () => selectFolder(folder.id));

    // Add the fully assembled button to the sidebar list
    folderSidebarList.appendChild(btn);
  });
}

/**
 * Select a folder — update the active state and re-render the URL list.
 *
 * @param {string} folderId — The ID of the folder to select, or "__general__"
 */
async function selectFolder(folderId) {
  activeFolderId = folderId;
  await browser.storage.local.set({ activeFolderId }); // Persist the active folder across popup opens
  renderSidebar(); // Re-render to update active highlighting
  renderUrlList(); // Show this folder's URLs in the main panel
}

/* ==========================================================================
   FOLDER CRUD
   ========================================================================== */

/**
 * Create a new folder with the given name.
 *
 * Generates a unique ID using Date.now() — this produces a timestamp
 * in milliseconds (e.g., 1710000000000), which is effectively unique
 * for our purposes since a user can't create two folders in the same
 * millisecond via a UI click.
 *
 * @param {string} name — The display name for the new folder
 */
async function createFolder(name) {
  const trimmedName = name.trim();
  if (!trimmedName) return; // Don't create folders with empty names
  // I can possibly add a check here to prevent duplicate folder names, but since the ID is unique, it won't cause any technical issues — just might be confusing for users to have multiple folders with the same name.

  const newFolder = {
    id: "f-" + Date.now(), // Unique ID
    name: trimmedName,
    urls: [],
  };

  // Array.push() adds the new folder to the END of the array
  folderData.folders.push(newFolder);
  await saveFolderData();

  activeFolderId = newFolder.id;
  await browser.storage.local.set({ activeFolderId });


  // Re-render the sidebar to show the new folder
  renderSidebar();
}

/**
 * Delete a folder by its ID.
 *
 * Array.filter() creates a NEW array containing only the elements where
 * the callback returns true. Here we keep everything EXCEPT the folder
 * with the matching ID, effectively "removing" it.
 *
 * @param {string} folderId — The ID of the folder to delete
 */
async function deleteFolder(folderId) {
  // Find the folder to get its name for the confirmation message
  const folder = folderData.folders.find((f) => f.id === folderId);
  const folderIndex = folderData.folders.findIndex((f) => f.id === folderId);
  if (!folder) return;

  // ── Confirmation dialogue ──
  // The built-in confirm() function pauses execution and shows a native
  // browser prompt with "OK" and "Cancel" buttons. It returns true if OK.
  if (
    !confirm(
      `Are you sure you want to delete the folder "${folder.name}" and all its saved URLs?`,
    )
  ) {
    return; // User clicked Cancel
  }

  // Proceed with deletion if the user clicked OK
  folderData.folders = folderData.folders.filter((f) => f.id !== folderId);
  await saveFolderData();

  // If the deleted folder was the one being viewed, fall back to General
  // I should change this to select the next folder if possible, else the previous one. If no folder exists, 
  // then change text to the right to say something like "No folders exist"

  if (folderData.folders.at(folderIndex)) {
    activeFolderId = folderData.folders.at(folderIndex).id;
  } else if (folderData.folders.at(folderIndex - 1)) {
    activeFolderId = folderData.folders.at(folderIndex - 1).id;
  } else {
    activeFolderId = null; // No folders left
  }
  await browser.storage.local.set({ activeFolderId });

  renderSidebar();
  renderUrlList();
}

/* ==========================================================================
   URL LIST — RENDER
   ========================================================================== */

/**
 * Render the URL list in the main panel for the currently active folder.
 *
 * If the active folder is "__general__" (the virtual General folder),
 * we compute a union (combination) of all URLs across every folder.
 * We use a Set to automatically deduplicate URLs that appear in
 * multiple folders.
 *
 * A Set is a built-in JavaScript data structure that stores UNIQUE values.
 * Adding a value that already exists is silently ignored. This makes it
 * perfect for deduplication.
 */
function renderUrlList() {
  // Clear the URL list
  urlListEl.innerHTML = "";

  if (folderData.folders.length === 0) {
    const msg = document.createElement("p");
    msg.className = "empty-folder-msg";
    msg.textContent = "No folders created yet.";
    urlListEl.appendChild(msg);
    return;
  }

  const folder = folderData.folders.find((f) => f.id === activeFolderId);
  const allFolderUrls = folder ? folder.urls : [];

  if (allFolderUrls.length === 0) {
    const msg = document.createElement("p");
    msg.className = "empty-folder-msg";
    msg.textContent = "No URLs saved yet.";
    urlListEl.appendChild(msg);
    return;
  }

  // Filter URLs based on current active tab ("all", "green", "yellow", "red")
  let urls = allFolderUrls;
  if (currentFolderFilter !== "all") {
    urls = allFolderUrls.filter((urlEntry) => {
      const stats = urlEntry.statsData;
      if (!stats) return false;

      const isRed = stats.malicious > 0;
      const isYellow = !isRed && stats.suspicious > 0;
      const isGreen = !isRed && !isYellow;

      if (currentFolderFilter === "green") return isGreen;
      if (currentFolderFilter === "yellow") return isYellow;
      if (currentFolderFilter === "red") return isRed;
      return true;
    });
  }

  if (urls.length === 0) {
    const msg = document.createElement("p");
    msg.className = "empty-folder-msg";
    const filterLabel = currentFolderFilter.charAt(0).toUpperCase() + currentFolderFilter.slice(1);
    msg.textContent = `No ${filterLabel} URLs in this folder.`;
    urlListEl.appendChild(msg);
    return;
  }

  // Create a DOM element for each URL item box
  urls.forEach((urlEntry) => {
    const urlLink = urlEntry.link;
    const item = document.createElement("div");
    item.className = "url-item";
    item.dataset.url = urlLink;

    // ── 1. Main Top Row Container ──
    const mainRow = document.createElement("div");
    mainRow.className = "url-item-main";

    // Far Left: Re-scan button (2-arrow reload icon)
    const rescanBtn = document.createElement("button");
    rescanBtn.className = "url-rescan-btn";
    rescanBtn.title = "Re-scan URL";
    rescanBtn.innerHTML = `<img src="../icons/refresh/tabler--refresh-16.png" class="url-rescan-icon" alt="Re-scan">`;

    // Middle-Left: Last scan time text
    const lastScanTimeEl = document.createElement("span");
    lastScanTimeEl.className = "url-last-scan-time";
    lastScanTimeEl.textContent = formatTimeAgo(urlEntry.lastScanTime);

    // Middle: Clickable truncated URL link
    const linkEl = document.createElement("a");
    linkEl.className = "url-item-link";
    linkEl.href = urlLink;
    linkEl.textContent = urlLink;
    linkEl.target = "_blank";
    linkEl.rel = "noopener noreferrer";
    linkEl.title = urlLink;

    // Warn the user before opening suspicious or malicious links
    const stats = urlEntry.statsData;
    const isMalicious = stats && stats.malicious > 0;
    const isSuspicious = stats && !isMalicious && stats.suspicious > 0;
    if (isMalicious || isSuspicious) {
      const level = isMalicious ? "MALICIOUS" : "SUSPICIOUS";
      const detail = isMalicious
        ? `${stats.malicious} engine(s) flagged it as malicious.`
        : `${stats.suspicious} engine(s) flagged it as suspicious.`;
      linkEl.addEventListener("click", (e) => {
        e.preventDefault();
        const confirmed = window.confirm(
          `⚠️ Warning: This URL has a ${level} verdict.\n${detail}\n\nAre you sure you want to open it?`
        );
        if (confirmed) {
          window.open(urlLink, "_blank", "noopener,noreferrer");
        }
      });
    }

    // Far Right: Action buttons group
    const actionsGroup = document.createElement("div");
    actionsGroup.className = "url-actions";

    // Dropdown chevron button
    const dropdownBtn = document.createElement("button");
    dropdownBtn.className = "url-dropdown-btn";
    dropdownBtn.title = "Toggle scan details";
    dropdownBtn.innerHTML = `<img src="../icons/chevron-down/tabler--chevron-down-16.png" class="url-dropdown-icon" alt="Toggle details">`;

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "url-delete-btn";
    deleteBtn.innerHTML = `<img src="../icons/delete/tabler--circle-x-filled-32.png" class="url-delete-icon" alt="Remove URL">`;
    deleteBtn.title = "Remove URL";
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteUrlFromFolder(urlLink);
    });

    actionsGroup.appendChild(dropdownBtn);
    actionsGroup.appendChild(deleteBtn);

    mainRow.appendChild(rescanBtn);
    mainRow.appendChild(lastScanTimeEl);
    mainRow.appendChild(linkEl);
    mainRow.appendChild(actionsGroup);

    // ── 2. Collapsible Details Panel (Dropdown) ──
    const detailsPanel = document.createElement("div");
    detailsPanel.className = "url-details-panel hidden";

    detailsPanel.innerHTML = `
      <div class="url-details-header">
        <div class="url-details-verdict">
          <span class="verdict-badge url-verdict-badge hidden"></span>
          <span class="url-verdict-status">No scan data available</span>
        </div>
        <a class="btn-open-vt url-btn-open-vt hidden" href="#" target="_blank" rel="noopener noreferrer" title="Open new tab for more detailed VirusTotal results">
          <svg class="vt-external-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      </div>
      <div class="url-details-stats">
        <div class="detail-row"><span class="detail-label">Malicious:</span> <span class="stat-val malicious stat-malicious">-</span></div>
        <div class="detail-row"><span class="detail-label">Suspicious:</span> <span class="stat-val suspicious stat-suspicious">-</span></div>
        <div class="detail-row"><span class="detail-label">Undetected:</span> <span class="stat-val stat-undetected">-</span></div>
        <div class="detail-row"><span class="detail-label">Harmless:</span> <span class="stat-val harmless stat-harmless">-</span></div>
        <div class="detail-row"><span class="detail-label">Timeout:</span> <span class="stat-val stat-timeout">-</span></div>
      </div>
    `;

    // Dropdown toggle click listener
    dropdownBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isHidden = detailsPanel.classList.toggle("hidden");
      item.classList.toggle("expanded", !isHidden);
    });

    // Re-scan button click listener
    rescanBtn.addEventListener("click", async (e) => {
      try {
        const itemContainer = e.currentTarget.closest(".url-item");
        await scanAndPersistFolderUrl(itemContainer.dataset.url, itemContainer);
      } catch (err) {
        console.error("Failed to fetch report:", err);
      }
    });

    item.appendChild(mainRow);
    item.appendChild(detailsPanel);
    urlListEl.appendChild(item);

    if (urlEntry.statsData) {
      updateFolderUrlItemUI(item, urlEntry.statsData, getBase64CachedUrlId(urlLink), urlEntry.lastScanTime);
    }
  });
}

/**
 * Format a Unix timestamp (milliseconds or seconds) into a human-readable time-ago string.
 *
 * Rules:
 *  - Under 1 minute: "Just now"
 *  - Under 60 minutes: "Xm ago"
 *  - Under 24 hours: "Xh ago"
 *  - Under 7 days: "Xd ago"
 *  - 7+ days (1 week+): "1+ week ago"
 *  - Missing / Unscanned: "-"
 *
 * @param {number|null} timestampMs - Unix timestamp
 * @returns {string} Formatted human-readable string
 */
function formatTimeAgo(timestampMs) {
  if (!timestampMs) return "-";

  const timestamp = timestampMs < 100000000000 ? timestampMs * 1000 : timestampMs;
  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 0) return "Just now";

  const elapsedMins = Math.floor(elapsedMs / (1000 * 60));
  const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
  const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));

  if (elapsedMins < 1) {
    return "Just now";
  } else if (elapsedMins < 60) {
    return `${elapsedMins} mins ago`;
  } else if (elapsedHours < 24) {
    return `${elapsedHours} hours ago`;
  } else if (elapsedDays < 7) {
    return `${elapsedDays} days ago`;
  } else {
    return "1+ week ago";
  }
}

/**
 * Perform VirusTotal scan (or cache lookup) for a folder URL and persist results.
 *
 * @param {string} urlLink - The URL string to analyze
 * @param {HTMLElement} itemContainer - The .url-item DOM container box
 */
async function scanAndPersistFolderUrl(urlLink, itemContainer, forceRescan = false) {
  const folder = folderData.folders.find((f) => f.id === activeFolderId);
  if (!folder) return;

  const entry = folder.urls.find((e) => e.link === urlLink);
  if (!entry) return;

  if (!forceRescan && entry.lastScanTime && getHoursAgo(Math.floor(entry.lastScanTime / 1000)) < 12) {
    showToast("Skipping Scan", `${urlLink} was scanned less than 12 hours ago.`, "info");
    return;
  }

  await browser.runtime.sendMessage({
    action: "scanFolderUrl",
    urlLink: urlLink,
    folderId: activeFolderId,
    forceRescan: forceRescan
  });
}

/**
 * Update the UI elements inside a URL container box with stats and scan time.
 *
 * @param {HTMLElement} itemContainer - The .url-item DOM element
 * @param {Object} statsData - Object containing malicious, suspicious, undetected, harmless, timeout counts
 * @param {string} urlId - Base64 encoded URL identifier for VirusTotal
 * @param {number|null} lastScanTime - Unix timestamp of the last scan
 */
function updateFolderUrlItemUI(itemContainer, statsData, urlId, lastScanTime = null) {
  const maliciousCount = statsData.malicious;
  const suspiciousCount = statsData.suspicious;

  // 1. Scoped sub-element selectors
  const badge = itemContainer.querySelector(".url-verdict-badge");
  const statusEl = itemContainer.querySelector(".url-verdict-status");
  const openVtBtn = itemContainer.querySelector(".url-btn-open-vt");
  const lastScanEl = itemContainer.querySelector(".url-last-scan-time");

  // 2. Set verdict container color
  itemContainer.classList.remove("verdict-green", "verdict-yellow", "verdict-red");
  badge.classList.remove("hidden", "green", "yellow", "red");

  if (maliciousCount > 0) {
    itemContainer.classList.add("verdict-red");
    badge.classList.add("red");
  } else if (suspiciousCount > 0) {
    itemContainer.classList.add("verdict-yellow");
    badge.classList.add("yellow");
  } else {
    itemContainer.classList.add("verdict-green");
    badge.classList.add("green");
  }

  // 3. Set text, external link, and last scan time
  statusEl.textContent = `${maliciousCount} / 92 engines detected threats`;
  openVtBtn.href = `https://www.virustotal.com/gui/url/${urlId}`;
  openVtBtn.classList.remove("hidden");

  if (lastScanEl && lastScanTime) {
    lastScanEl.textContent = formatTimeAgo(lastScanTime);
  }

  // 4. Update stats breakdown
  itemContainer.querySelector(".stat-malicious").textContent = statsData.malicious;
  itemContainer.querySelector(".stat-suspicious").textContent = statsData.suspicious;
  itemContainer.querySelector(".stat-undetected").textContent = statsData.undetected;
  itemContainer.querySelector(".stat-harmless").textContent = statsData.harmless;
  itemContainer.querySelector(".stat-timeout").textContent = statsData.timeout;
}

/**
 * Delete a URL from the currently active folder.
 *
 * If viewing the General folder, we remove the URL from ALL folders
 * that contain it (since General is a union view).
 *
 * Array.filter() creates a new array excluding the URL to delete.
 *
 * @param {string} urlLink — The URL string to remove
 */
async function deleteUrlFromFolder(urlLink) {

  // Remove from the specific active folder only
  const folder = folderData.folders.find((f) => f.id === activeFolderId);
  if (folder) {
    folder.urls = folder.urls.filter((entry) => entry.link !== urlLink);
  }

  await saveFolderData();
  renderUrlList();
}

/* ==========================================================================
   SEARCH
   Searches all stored URLs by substring match and displays results in a
   dropdown below the search bar. Each result shows the matching URL and
   which folder(s) it belongs to. Clicking a result selects that folder
   and highlights the URL.
   ========================================================================== */

/**
 * Perform a search across all folders for URLs matching the query.
 *
 * Returns an array of result objects, each containing:
 *   - url:        the matching URL string
 *   - folderId:   the ID of a folder containing this URL
 *   - folderName: the display name of that folder
 *
 * A single URL can appear in multiple results if it exists in multiple folders.
 *
 * String.toLowerCase() converts a string to all lowercase letters.
 * We use it on both the query and the URL so that searching "GITHUB"
 * will match "https://github.com" — this is called "case-insensitive" matching.
 *
 * String.includes(substring) returns true if the string contains the
 * given substring anywhere within it.
 *
 * @param {string} query — The search text
 * @returns {Array} — Array of { url, folderId, folderName } objects
 */
function searchUrls(query) {
  const lowerQuery = query.toLowerCase();
  const results = [];

  folderData.folders.forEach((folder) => {
    folder.urls.forEach((entry) => {
      if (entry.link.toLowerCase().includes(lowerQuery)) {
        results.push({
          url: entry.link,
          folderId: folder.id,
          folderName: folder.name,
        });
      }
    });
  });

  return results;
}

/**
 * Render search results in the dropdown below the search bar.
 *
 * @param {Array} results — Array of { url, folderId, folderName } from searchUrls()
 */
function renderSearchResults(results) {
  // Clear old results
  searchResultsEl.innerHTML = "";

  if (results.length === 0) {
    // Show a "no results" message
    const noResults = document.createElement("div");
    noResults.className = "search-result-item";
    noResults.innerHTML = `<span class="search-result-url" style="color: var(--text-muted);">No matching URLs found</span>`;
    searchResultsEl.appendChild(noResults);
    searchResultsEl.classList.remove("hidden");
    return;
  }

  results.forEach((result) => {
    const item = document.createElement("div");
    item.className = "search-result-item";

    // URL text
    const urlSpan = document.createElement("div");
    urlSpan.className = "search-result-url";
    urlSpan.textContent = result.url;

    // Folder name label below the URL
    const folderSpan = document.createElement("div");
    folderSpan.className = "search-result-folder";
    folderSpan.textContent = "📁 " + result.folderName;

    item.appendChild(urlSpan);
    item.appendChild(folderSpan);

    // When clicked, navigate to the folder and highlight the URL
    item.addEventListener("click", () => {
      navigateToUrl(result.folderId, result.url);
    });

    searchResultsEl.appendChild(item);
  });

  // Show the dropdown
  searchResultsEl.classList.remove("hidden");
}

/**
 * Navigate to a specific folder and visually highlight a URL in the list.
 *
 * This is called when the user clicks a search result. It:
 *   1. Selects the folder containing the URL
 *   2. Finds the URL item in the rendered list
 *   3. Scrolls to it using scrollIntoView()
 *   4. Adds a temporary highlight effect
 *   5. Clears the search bar and hides the results dropdown
 *
 * @param {string} folderId — ID of the folder to switch to
 * @param {string} url      — URL to scroll to and highlight
 */
function navigateToUrl(folderId, url) {
  // Switch to the target folder
  activeFolderId = folderId;
  renderSidebar();
  renderUrlList();

  // Find the URL element in the rendered list.
  // document.querySelector() finds the FIRST element matching a CSS selector.
  // We use a CSS attribute selector [data-url="..."] to find the element
  // with the matching data-url attribute.
  //
  // CSS.escape() is needed because URLs contain characters like : / ?
  // that have special meaning in CSS selectors. CSS.escape() puts
  // backslashes in front of those characters so they're treated literally.
  const urlItem = urlListEl.querySelector(
    `.url-item[data-url="${CSS.escape(url)}"]`,
  );

  if (urlItem) {
    // scrollIntoView() scrolls the page (or scrollable container) so that
    // this element is visible. { behavior: "smooth" } makes it animate.
    // { block: "center" } positions the element in the vertical centre.
    urlItem.scrollIntoView({ behavior: "smooth", block: "center" });

    // Add the "highlight" CSS class for a visual flash effect
    urlItem.classList.add("highlight");

    // Remove the highlight after 1.5 seconds.
    // setTimeout(callback, delayMs) schedules a function to run after
    // a specified number of milliseconds.
    setTimeout(() => {
      urlItem.classList.remove("highlight");
    }, 1500);
  }

  // Clear the search bar and hide results
  searchInput.value = "";
  searchResultsEl.classList.add("hidden");
}

/* ==========================================================================
   EVENT LISTENERS
   All user interactions are handled via event listeners attached to DOM
   elements. An event listener is a function that runs when a specific
   event (click, input, keydown, etc.) occurs on an element.
   ========================================================================== */

// ── Tab switching ───────────────────────────────────────────────────
// Map of tab IDs to their content panels.
// This object lets us look up which panel to show based on the
// data-tab attribute of the clicked tab button.
const panels = {
  folders: panelFolders,
  url_check: panelURL_Check,
  // image: panelImage,
};

tabButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    Object.values(panels).forEach((p) => p.classList.remove("active"));

    btn.classList.add("active");
    const panel = panels[btn.dataset.tab];
    if (panel) panel.classList.add("active");

    await saveActiveTab(btn.dataset.tab);
  });
});

// ── "New Folder" button ─────────────────────────────────────────────
// First click: show the text input so the user can type a folder name.
// The folder is actually CREATED when the user presses Enter in the input.
btnNewFolder.addEventListener("click", () => {
  // Toggle the hidden class on the input to show/hide it
  newFolderInput.classList.toggle("hidden");

  // If the input is now visible, focus it so the user can start typing
  // immediately without having to click inside it.
  if (!newFolderInput.classList.contains("hidden")) {
    // .focus() places the text cursor inside the input field
    newFolderInput.focus();
  }
});

// Mark listener as async so we can use await
btnURL_Check.addEventListener("click", async () => {
  try {
    const urlToCheck = urlInput.value.trim();
    if (!urlToCheck) {
      showToast("Input Required", "Please enter a valid URL to check.", "warning", 4000);
      return;
    }
    await browser.runtime.sendMessage({
      action: "scanSingleUrl",
      urlLink: urlToCheck
    });
  } catch (err) {
    console.error("Failed to trigger background scan:", err);
  }
});

/**
 * Converts any URL string into a VirusTotal v3 url_id.
 * Used for the Scan URL endpoint: https://developers.virustotal.com/reference/scan-url
 * Without the base64 encoding, the API will instead automatically re-analyze the URL, but we
 * want to first check how long ago the cached result was generated and if it is too old, then we can re-analyze the URL.
 * 
 * @param {string} url - The web address (e.g., "https://example.com/page")
 * @returns {string} The formatted url_id string required by VirusTotal
 */
function getBase64CachedUrlId(url) {
  // Step 1: Convert the URL string to UTF-8 bytes (handles special characters safely)
  const utf8Bytes = new TextEncoder().encode(url);

  // Step 2: Convert UTF-8 bytes into a binary string for btoa()
  const binaryString = Array.from(utf8Bytes, (byte) => String.fromCharCode(byte)).join("");

  // Step 3: Convert to standard Base64 string
  const base64 = btoa(binaryString);

  // Step 4: Make URL-safe (replace + with -, / with _, and remove = padding)
  return base64
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getLocalTime(unixTimestamp) {
  // 1. Extract the raw Unix timestamp from the VirusTotal API response
  // const unixTimestamp = response.data.attributes.date; // e.g. 1785116731

  // 2. Convert seconds to milliseconds and pass to Date constructor
  const dateObject = new Date(unixTimestamp * 1000);

  // 3. Format as a readable local date and time string
  const localTimeString = dateObject.toLocaleString();

  return localTimeString;
  // Output on your device (e.g.): "7/26/2026, 6:45:31 PM" (in your local timezone)

}

function getSecondsAgo(unixTimestamp) {
  // 1. Extract the raw Unix timestamp from the VirusTotal API response
  // const unixTimestamp = response.data.attributes.date; // e.g. 1785116731
  // const ms = Date.now() - unixTimestamp;
  const currentSeconds = Math.floor(Date.now() / 1000);
  const difference = currentSeconds - unixTimestamp;
}

function getHoursAgo(unixTimestamp) {
  const currentSeconds = Math.floor(Date.now() / 1000);
  const difference = currentSeconds - unixTimestamp;

  return Math.floor(difference / 3600);
}


/**
 * Centralized fetch helper for VirusTotal API requests with graceful error handling.
 * Handles 429 Rate Limiting, 401/403 Invalid API Keys, 404 Cache Misses, 5xx Server Outages, and Network drops.
 *
 * @param {string} url - API Endpoint URL
 * @param {object} options - Fetch options object
 * @returns {Promise<object|null>} JSON response object, or null on handled error
 */
async function fetchVirusTotal(url, options) {
  try {
    const response = await fetch(url, options);

    if (response.status === 429) {
      showToast(
        "Rate Limit Exceeded",
        "VirusTotal free API rate limit reached (4 requests/min max). Please wait a minute before retrying.",
        "warning",
        8000
      );
      return null;
    }

    if (response.status === 401 || response.status === 403) {
      showToast(
        "Invalid API Key",
        "Your VirusTotal API key was rejected. <a href='#' id='toast-open-settings'>Open Settings</a> to verify your key.",
        "error",
        0
      );
      const settingsLink = toastContainer.querySelector("#toast-open-settings");
      if (settingsLink) {
        settingsLink.addEventListener("click", (e) => {
          e.preventDefault();
          browser.runtime.openOptionsPage();
        });
      }
      return null;
    }

    if (response.status === 404) {
      return { notFound: true };
    }

    if (!response.ok) {
      showToast(
        "VirusTotal Service Error",
        `VirusTotal servers returned HTTP status ${response.status}. Please try again later.`,
        "error",
        7000
      );
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error("[VirusTotal API Fetch Error]:", err);
    showToast(
      "Network Error",
      "Unable to connect to VirusTotal. Please check your internet connection.",
      "error",
      7000
    );
    return null;
  }
}

async function checkCachedUrlReport(urlId) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-apikey": apiKey
    }
  };

  return await fetchVirusTotal(`https://www.virustotal.com/api/v3/urls/${urlId}`, options);
}

async function requestURL_Rescan(urlId) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  const options = {
    method: "POST",
    headers: {
      accept: "application/json",
      "x-apikey": apiKey
    }
  };

  return await fetchVirusTotal(`https://www.virustotal.com/api/v3/urls/${urlId}/analyse`, options);
}

async function getRecentUrlReport(urlToFetch) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-apikey": apiKey
    }
  };

  const MAX_ATTEMPTS = 10;
  const POLL_INTERVAL_MS = 20000;
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const data = await fetchVirusTotal(urlToFetch, options);
    if (!data) return null;

    const status = data?.data?.attributes?.status;

    if (status === "completed") {
      showToast(
        "Poll Complete",
        `Analysis completed after ${attempt} attempt(s).`,
        "info"
      );
      return data;
    }

    if (attempt < MAX_ATTEMPTS) {
      showToast(
        "Poll Status",
        `(Attempt ${attempt}/${MAX_ATTEMPTS}) | Status: ${status} | Waiting ${POLL_INTERVAL_MS / 1000}s before next check...`,
        "info",
        POLL_INTERVAL_MS
      );
      await wait(POLL_INTERVAL_MS);
    }
  }

  showToast(
    "Scan Timeout",
    `VirusTotal scan did not complete after ${MAX_ATTEMPTS} attempts.`,
    "error"
  );
  return null;
}

function updateScanResultsUI(statsData, urlId) { // Need to make changes here as well
  // URL Object uses `last_analysis_stats`, Analysis Object uses `stats`.
  // Extract whichever one exists into a single `stats` variable.
  // const stats = JSON.data.attributes.last_analysis_stats ?? JSON.data.attributes.stats;

  // Now all field accesses are clean and identical regardless of source
  const maliciousCount = statsData.malicious;
  const suspiciousCount = statsData.suspicious;
  const harmlessCount = statsData.harmless;
  const undetectedCount = statsData.undetected;
  const timeoutCount = statsData.timeout;

  statMalicious.textContent = maliciousCount;
  statSuspicious.textContent = suspiciousCount;
  statHarmless.textContent = harmlessCount;
  statUndetected.textContent = undetectedCount;
  statTimeout.textContent = timeoutCount;

  if (maliciousCount > 0) {
    scanResultCard.classList.add("verdict-red");
    scanVerdictBadge.classList.remove("hidden");
    scanVerdictBadge.classList.add("red");
  }
  else if (suspiciousCount > 0) {
    scanResultCard.classList.add("verdict-yellow");
    scanVerdictBadge.classList.remove("hidden");
    scanVerdictBadge.classList.add("yellow");
  }
  else {
    scanResultCard.classList.add("verdict-green");
    scanVerdictBadge.classList.remove("hidden");
    scanVerdictBadge.classList.add("green");
  }

  scanResultStatus.textContent = ` ${maliciousCount} / 92 engines detected threats.`

  btnOpenVT.href = `https://www.virustotal.com/gui/url/${urlId}`;
  // btnOpenVT.href = JSON.data.links.self; // DO NOT USE THIS LINK, IT IS THE API LINK, NOT THE GUI LINK. The GUI link is the one above.
  btnOpenVT.classList.remove("hidden");

}

// ── New folder input: create folder on Enter key ────────────────────
// The "keydown" event fires every time a key is pressed while the input
// is focused. We check if the pressed key is "Enter" to trigger creation.

// Here is where we want to add a check for duplicate folder names. 
// Before calling createFolder(name), we can check if a folder with the same name already exists in folderData.folders. 
// If it does, we can alert the user and not create the folder.

// For the error message, we can use alert() to show a simple popup message <- More intrusive as user needs to manually close it.
// or we can replace the placeholder text in the input field with an error message.

newFolderInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const name = newFolderInput.value;

    if (folderData.folders.some((f) => f.name.toLowerCase() === name.trim().toLowerCase())) {
      // If a folder with the same name already exists, show an error message
      alert(`A folder named "${name.trim()}" already exists. Please choose a different name.`);
      return; // Don't create the folder
    }
    else if (name.trim()) {
      await createFolder(name);
      newFolderInput.value = ""; // Clear the input
      newFolderInput.classList.add("hidden"); // Hide it again
    }
  }
  // If "Escape" is pressed, cancel and hide the input
  if (e.key === "Escape") {
    newFolderInput.value = "";
    newFolderInput.classList.add("hidden");
  }
});

// ── Search input ────────────────────────────────────────────────────
// The "input" event fires every time the value of the input changes
// (on every keystroke, paste, cut, etc.).
searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();

  if (!query) {
    // If the search field is empty, hide the results dropdown
    searchResultsEl.classList.add("hidden");
    return;
  }

  const results = searchUrls(query);
  renderSearchResults(results);
});

// ── Close search results when clicking outside ──────────────────────
// We listen for clicks on the entire document. If the click target is
// NOT inside the search wrapper (search input + results dropdown),
// we hide the results.
//
// .closest(selector) walks up the DOM tree from the clicked element
// looking for an ancestor matching the selector. If it finds one,
// the click was "inside" that element. If not, the click was "outside".
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrapper")) {
    searchResultsEl.classList.add("hidden");
  }
});

// ── Light / Dark mode toggle ────────────────────────────────────────
// When switching modes, we:
//   1. Toggle the dark-mode class
//   2. Swap the moon/sun icon
btnTheme.addEventListener("click", async () => {

  document.body.classList.toggle("dark-mode");
  const isDark = document.body.classList.contains("dark-mode");

  iconMoon.classList.toggle("hidden", !isDark);
  iconSun.classList.toggle("hidden", isDark);

  // Persist the mode switch
  await saveThemeState();
});

// ── Settings button → open the options page ─────────────────────────
btnSettings.addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

// ── Help button — placeholder ───────────────────────────────────────
btnHelp.addEventListener("click", () => {
  showToast(
    "No action defined",
    `This button currently has no action defined. Check the extension's page in the extension store where you installed it for more information.`,
    "info",
    10000
  );
});

/* ==========================================================================
   STORAGE CHANGE LISTENER
   Automatically refresh the popup when data changes in storage.

   This is important because the user might save a URL via the context
   menu (which writes to storage from the picker page) while the popup
   is open. Without this listener, the popup would show stale data.

   browser.storage.onChanged fires whenever ANY key in storage changes.
   The callback receives:
     changes   — an object where each key that changed maps to an object
                 with { oldValue, newValue }
     areaName  — which storage area changed ("local", "sync", or "managed")
   ========================================================================== */
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.folderData) {
    folderData = changes.folderData.newValue || { folders: [] };
    renderSidebar();
    renderUrlList();
  }

  if (changes.latestSingleScanResult && changes.latestSingleScanResult.newValue) {
    const res = changes.latestSingleScanResult.newValue;
    updateScanResultsUI(res.statsData, res.urlId);
  }
});

/* ==========================================================================
   INIT — Kick everything off
   ========================================================================== */
init();
