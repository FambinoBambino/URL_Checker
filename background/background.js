/**
 * background.js — The extension's "event page" (MV3 non-persistent background script).
 *
 * KEY CONCEPT: In MV3 Firefox, this script is NOT always running. Firefox loads
 * it when an event fires, runs the relevant listener, then unloads the script
 * after it's been idle for a while. This saves memory and battery.
 *
 * IMPORTANT RULE: Because Firefox needs to know which events you care about
 * BEFORE the script loads, all event listeners MUST be registered at the
 * TOP LEVEL of this file — never inside a setTimeout, a promise .then(), or
 * another callback. If you register a listener inside a callback, Firefox
 * won't know about it and won't wake your script when that event fires.
 *
 * Think of it like subscribing to a mailing list: you have to sign up
 * (register the listener) before you can receive mail (events). If you
 * sign up too late, the mail has already been delivered and you missed it.
 */

// ── Compatibility shim ──────────────────────────────────────────────
// Firefox uses `browser.menus` while Chrome uses `browser.contextMenus`.
// Some Firefox versions may only expose one of them. This shim tries
// browser.menus first, then falls back to browser.contextMenus.
//
// The "||" operator returns the first "truthy" value. If browser.menus
// exists (is not undefined/null), menusAPI will be browser.menus.
// If it doesn't exist, menusAPI falls back to browser.contextMenus.
const menusAPI = browser.menus || browser.contextMenus;

// ── onInstalled ─────────────────────────────────────────────────────
// Fires when the extension is first installed, updated to a new version,
// or when Firefox itself is updated.
// Common uses: set default settings, show a welcome page, migrate data.
browser.runtime.onInstalled.addListener((details) => {
    // "details.reason" tells you WHY this event fired:
    //   "install"  → first time the user installed the extension
    //   "update"   → the extension was updated to a new version
    //   "browser_update" → Firefox itself was updated

    if (details.reason === "install") {
        // Set default preferences in storage.
        // browser.storage.local.set() takes an object of key-value pairs.
        browser.storage.local.set({
            extensionEnabled: true,
            // folderData holds all user-created folders and their URLs.
            // The "General" folder isn't stored — it's computed on the fly as
            // a union (combination) of all folders' URLs.
            folderData: {
                folders: [],
            },
            // contextMenuMode controls how the right-click menu works:
            //   "simple"  → one menu item, opens the picker popup
            //   "submenu" → parent item that expands into child items for quick selection
            contextMenuMode: "simple"
        });
    }

    // Build the context menus after install/update
    buildContextMenu();
});

/* ==========================================================================
   CONTEXT MENU BUILDING

   buildContextMenu() reads the current mode and folder data from storage,
   then creates the appropriate menu items. It removes any existing items
   first to avoid duplicates.

   Two modes:
     SIMPLE MODE:
       One menu item → "Save URL to folder…" → opens picker popup

     SUBMENU MODE:
       Parent: "Save URL to folder…"
       Children:
         📥 General          (saves directly to all-folders union)
         📁 Folder 1         (saves directly)
         📁 Folder 2         (saves directly)
         ... (up to 8 user folders)
         🔍 Search for folder…  (opens picker popup)
   ========================================================================== */

/**
 * Build or rebuild the context menu based on the current settings.
 *
 * This is called:
 *   - At the top level when the script loads (event page wake-up)
 *   - On install/update
 *   - When the user changes settings (via a "rebuildMenus" message)
 *   - When folderData changes in storage (new/deleted folders)
 */
async function buildContextMenu() {
    if (!menusAPI) {
        console.error("[background] No menus API available!");
        return;
    }

    // Remove all existing menu items created by this extension.
    // menusAPI.removeAll() returns a Promise that resolves when done.
    // This ensures we start with a clean slate every time.
    await menusAPI.removeAll();

    // Read the current mode and folder data from storage
    const data = await browser.storage.local.get([
        "contextMenuMode",
        "folderData",
    ]);
    const mode = data.contextMenuMode || "simple";
    const folders = data.folderData?.folders || [];

    if (mode === "submenu") {
        // ── SUBMENU MODE ────────────────────────────────────────────

        // 1. Create the PARENT menu item.
        //    parentId is NOT set, so this lives at the top level of the context menu.
        //    Child items will reference this item's id as their parentId.
        menusAPI.create({
            id: "save-url-parent",
            title: "Save URL to folder…",
            contexts: ["page", "link"],
        });

        // 2. Create the "General" child item (always first).
        //    parentId links it under the parent item we just created.
        //    In sub-menus, items appear in the ORDER they are created.
        // menusAPI.create({
        //     id: "save-to-general",
        //     parentId: "save-url-parent",
        //     title: "📥 General",
        //     contexts: ["page", "link"],
        // });

        // 3. Create child items for up to 8 user-created folders.
        //    Array.slice(0, 8) returns a new array with at most the first 8 elements.
        //    This keeps the submenu compact even if the user has dozens of folders.
        const displayedFolders = folders.slice(0, 8);

        displayedFolders.forEach((folder) => {
            menusAPI.create({
                id: "save-to-folder-" + folder.id,
                parentId: "save-url-parent",
                title: "📁 " + folder.name,
                contexts: ["page", "link"],
            });
        });

        // 4. "Create New Folder..." — opens the picker popup and immediately prompts
        menusAPI.create({
            id: "save-url-new-folder",
            parentId: "save-url-parent",
            title: "➕ Create New Folder…",
            contexts: ["page", "link"],
        });

        // 5. Add a separator before "Search for folder…"
        //    type: "separator" draws a horizontal line in the menu.
        menusAPI.create({
            id: "save-url-separator",
            parentId: "save-url-parent",
            type: "separator",
            contexts: ["page", "link"],
        });

        // 5. "Search for folder…" — opens the picker popup (same as simple mode)
        menusAPI.create({
            id: "save-url-search",
            parentId: "save-url-parent",
            title: "🔍 Search for folder…",
            contexts: ["page", "link"],
        });
    } else {
        // ── SIMPLE MODE (default) ───────────────────────────────────
        // One flat menu item that opens the picker popup.
        menusAPI.create(
            {
                id: "save-url-to-folder",
                title: "Save URL to folder…",
                contexts: ["page", "link"],
            },
            () => {
                if (browser.runtime.lastError) {
                    console.warn(
                        "[background] Menu create warning:",
                        browser.runtime.lastError.message
                    );
                }
            }
        );
    }
}

// ── Build menus at script load ──────────────────────────────────────
// This is at the TOP LEVEL so it runs every time the event page wakes up.
buildContextMenu();

/* ==========================================================================
   CONTEXT MENU CLICK HANDLER

   Must be registered at the TOP LEVEL so Firefox can wake the event page
   whenever the user clicks any of our menu items.

   We handle clicks differently depending on which item was clicked:
     - "save-url-to-folder" (simple mode) → open picker popup
     - "save-url-search"    (submenu)      → open picker popup
     - "save-to-general"    (submenu)      → save URL to all folders directly
     - "save-to-folder-*"   (submenu)      → save URL to specific folder directly
   ========================================================================== */
if (menusAPI) {
    menusAPI.onClicked.addListener((info, tab) => {
        // Decide which URL to save:
        // - If the user right-clicked on a link, save the LINK's URL (info.linkUrl)
        // - If they right-clicked on the page background, save the PAGE's URL (info.pageUrl)
        const urlToSave = info.linkUrl || info.pageUrl;

        // ── Simple mode item OR "Search for folder…" → open picker popup ──
        if (
            info.menuItemId === "save-url-to-folder" ||
            info.menuItemId === "save-url-search"
        ) {
            openPickerWindow(urlToSave);
            return;
        }

        // ── "Create New Folder…" → open picker and auto-prompt ──
        if (info.menuItemId === "save-url-new-folder") {
            openPickerWindow(urlToSave, "new_folder");
            return;
        }

        // ── Specific folder → save directly ──
        // The menu item IDs for individual folders are formatted as
        // "save-to-folder-f-1234567890". We check if the menuItemId
        // starts with "save-to-folder-" to identify these.
        //
        // String.startsWith(prefix) returns true if the string begins
        // with the given prefix.
        if (info.menuItemId.startsWith("save-to-folder-")) {
            // Extract the folder ID by removing the "save-to-folder-" prefix.
            // String.replace() swaps the first occurrence of the prefix with "".
            const folderId = info.menuItemId.replace("save-to-folder-", "");
            saveUrlToFolder(folderId, urlToSave);
            return;
        }
    });
}

/* ==========================================================================
   HELPER FUNCTIONS — URL saving
   ========================================================================== */

/**
 * Open the folder picker popup window.
 *
 * browser.windows.create() opens a brand-new browser window.
 * We set type: "popup" to get a minimal window (no tabs bar, no address bar).
 *
 * We pass the URL to save as a query parameter in the picker page's URL.
 * encodeURIComponent() escapes special characters (like & or ?) so they
 * don't break the URL format.
 *
 * browser.runtime.getURL() converts a path relative to the extension's
 * root folder into a full "moz-extension://..." URL that Firefox can load.
 *
 * @param {string} url    — The URL to save to a folder
 * @param {string} action — Optional action flag (e.g., "new_folder")
 */
function openPickerWindow(url, action = null) {
    let pickerUrl =
        browser.runtime.getURL("picker/picker.html") +
        "?url=" +
        encodeURIComponent(url);

    if (action) {
        pickerUrl += "&action=" + encodeURIComponent(action);
    }

    browser.windows.create({
        url: pickerUrl,
        type: "popup",
        width: 500,
        height: 450,
    });
}

/**
 * Save a URL to a specific folder by ID.
 *
 * Reads the current folder data from storage, finds the folder,
 * adds the URL (if not already present), and writes back to storage.
 *
 * @param {string} folderId — The ID of the target folder
 * @param {string} url      — The URL to save
 */
async function saveUrlToFolder(folderId, url) {
    try {
        const { folderData } = await browser.storage.local.get("folderData");
        const folders = folderData?.folders || [];

        // Array.find() returns the first element matching the condition
        const folder = folders.find((f) => f.id === folderId);
        if (!folder) {
            console.warn("[background] Folder not found:", folderId);
            return;
        }

        // Don't add duplicates
        if (!folder.urls.some((entry) => entry.link === url)) {
            // folder.urls.push({ link: url, scanData: null });
            folder.urls.push({ link: url, statsData: null, lastScanTime: null });
            await browser.storage.local.set({ folderData });
        } else {
            notifyUser("Duplicate URL", `This URL already exists in folder:  ${folder.name} `, "info", 4000, false);
        }
    } catch (err) {
        console.error("[background] Failed to save URL to folder:", err);
    }
}

/* ==========================================================================
   LISTENERS
   ========================================================================== */

// ── onMessage ───────────────────────────────────────────────────────
// Fires when any part of the extension (popup, content script, options
// page) sends a message using browser.runtime.sendMessage().
//
// Parameters:
//   message      → the object that was sent
//   sender       → info about who sent it (tab id, url, etc.)
//   sendResponse → (callback style) call this to reply synchronously;
//                   OR return a Promise to reply asynchronously
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Rebuild context menus when the user changes the menu mode in settings.
    if (message.action === "rebuildMenus") {
        buildContextMenu();
        return;
    }

    if (message.action === "getSettings") {
        return browser.storage.local.get(["extensionEnabled", "folderData"]);
    }

    if (message.action === "scanSingleUrl") {
        enqueueScanTask({ type: "single", urlLink: message.urlLink, forceRescan: message.forceRescan });
        sendResponse({ queued: true });
        return;
    }

    if (message.action === "scanFolderUrl") {
        enqueueScanTask({ type: "folder", urlLink: message.urlLink, folderId: message.folderId, forceRescan: message.forceRescan });
        sendResponse({ queued: true });
        return;
    }

    if (message.action === "scanFolderBatch") {
        const urls = message.urls || [];
        urls.forEach((urlLink) => {
            enqueueScanTask({ type: "folder", urlLink, folderId: message.folderId, forceRescan: message.forceRescan });
        });
        sendResponse({ queued: true, count: urls.length });
        return;
    }
});

/* ==========================================================================
   BACKGROUND SCANNING ENGINE & QUEUE PROCESSOR
   ========================================================================== */

/**
 * Smart Notification Router:
 * Sends an in-app toast to the popup if it is open and listening.
 * If the popup is closed (or sendMessage fails), falls back to native desktop notifications.
 */
async function notifyUser(title, message, type = "info", duration = 6000, isScanning = false) {
  await browser.storage.local.set({
    activeScanStatus: {
      isScanning,
      title,
      message,
      type,
      duration,
      updatedAt: Date.now()
    }
  });

  try {
    const response = await browser.runtime.sendMessage({
      action: "showToast",
      title,
      message,
      type,
      duration
    });
    if (response && response.received) return;
  } catch (err) {
    if (browser.notifications) {
      try {
        await browser.notifications.create({
          type: "basic",
          iconUrl: browser.runtime.getURL("icons/extension-icon/tabler--virus-search-48-green.png"),
          title: `${title} - URL Checker`,
          message: message.replace(/<[^>]*>?/gm, "")
        });
      } catch (notifErr) {
        console.warn("[background] Desktop notification error:", notifErr);
      }
    }
  }
}

async function getApiKey() {
  const apiKey = (await browser.storage.local.get("virusTotalApiKey")).virusTotalApiKey ?? "";
  if (!apiKey) {
    notifyUser(
      "No API Key Set",
      "A VirusTotal API key is required to scan URLs. Open Settings to add your key.",
      "error",
      0,
      false
    );
    return null;
  }
  return apiKey;
}

function getBase64CachedUrlId(url) {
  const utf8Bytes = new TextEncoder().encode(url);
  const binaryString = Array.from(utf8Bytes, (byte) => String.fromCharCode(byte)).join("");
  const base64 = btoa(binaryString);
  return base64
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getHoursAgo(unixTimestamp) {
  const currentSeconds = Math.floor(Date.now() / 1000);
  const difference = currentSeconds - unixTimestamp;
  return Math.floor(difference / 3600);
}

async function fetchVirusTotal(url, options) {
  try {
    const response = await fetch(url, options);

    if (response.status === 429) {
      notifyUser(
        "Rate Limit Exceeded",
        "VirusTotal free API rate limit reached (4 requests/min max). Please wait a minute before retrying.",
        "warning",
        8000,
        false
      );
      return null;
    }

    if (response.status === 401 || response.status === 403) {
      notifyUser(
        "Invalid API Key",
        "Your VirusTotal API key was rejected. Please check your key in Settings.",
        "error",
        0,
        false
      );
      return null;
    }

    if (response.status === 404) {
      return { notFound: true };
    }

    if (!response.ok) {
      notifyUser(
        "VirusTotal Service Error",
        `VirusTotal servers returned HTTP status ${response.status}. Please try again later.`,
        "error",
        7000,
        false
      );
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error("[background] VirusTotal API Fetch Error:", err);
    notifyUser(
      "Network Error",
      "Unable to connect to VirusTotal. Please check your internet connection.",
      "error",
      7000,
      false
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

async function submitNewUrlScan(urlLink) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  const options = {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "x-apikey": apiKey
    },
    body: `url=${encodeURIComponent(urlLink)}`
  };

  return await fetchVirusTotal(`https://www.virustotal.com/api/v3/urls`, options);
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
      return data;
    }

    if (attempt < MAX_ATTEMPTS) {
      notifyUser(
        "Poll Status",
        `(Attempt ${attempt}/${MAX_ATTEMPTS}) | Status: ${status} | Waiting ${POLL_INTERVAL_MS / 1000}s before next check...`,
        "info",
        POLL_INTERVAL_MS,
        true
      );
      await wait(POLL_INTERVAL_MS);
    }
  }

  notifyUser(
    "Scan Timeout",
    `VirusTotal scan did not complete after ${MAX_ATTEMPTS} attempts.`,
    "error",
    6000,
    false
  );
  return null;
}

// ── FIFO Scan Queue ──────────────────────────────────────────────────
const scanQueue = [];
let isProcessingQueue = false;

function enqueueScanTask(task) {
  scanQueue.push(task);
  processScanQueue();
}

async function processScanQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (scanQueue.length > 0) {
    const currentTask = scanQueue.shift();
    try {
      if (currentTask.type === "single") {
        await executeSingleScan(currentTask.urlLink, currentTask.forceRescan);
      } else if (currentTask.type === "folder") {
        await executeFolderScan(currentTask.urlLink, currentTask.folderId, currentTask.forceRescan);
      }
    } catch (err) {
      console.error("[background] Error executing scan task:", err);
    }
  }

  isProcessingQueue = false;
}

async function executeSingleScan(urlLink, forceRescan = false) {
  notifyUser("Scan Started", `Scanning ${urlLink} in background...`, "info", 4000, true);

  const urlId = getBase64CachedUrlId(urlLink);
  const latestAnalysisJSON = await checkCachedUrlReport(urlId);
  if (!latestAnalysisJSON) return;

  let statsData;

  if (latestAnalysisJSON.notFound) {
    let requestJSON = await submitNewUrlScan(urlLink);
    if (!requestJSON || !requestJSON.data?.links?.self) {
      requestJSON = await requestURL_Rescan(urlId);
    }
    if (!requestJSON || !requestJSON.data?.links?.self) return;
    const tempJSON = await getRecentUrlReport(requestJSON.data.links.self);
    if (!tempJSON || !tempJSON.data?.attributes?.stats) return;
    statsData = tempJSON.data.attributes.stats;
  } else if (!forceRescan && latestAnalysisJSON.data?.attributes?.last_analysis_date && getHoursAgo(latestAnalysisJSON.data.attributes.last_analysis_date) < 12) {
    statsData = latestAnalysisJSON.data.attributes.last_analysis_stats;
    notifyUser("Recent Cache Loaded", `Using report from <12h ago for ${urlLink}`, "info", 5000, false);
  } else {
    const requestJSON = await requestURL_Rescan(urlId);
    if (!requestJSON || !requestJSON.data?.links?.self) return;
    const tempJSON = await getRecentUrlReport(requestJSON.data.links.self);
    if (!tempJSON || !tempJSON.data?.attributes?.stats) return;
    statsData = tempJSON.data.attributes.stats;
  }

  if (!statsData) return;

  const resultObj = {
    urlLink,
    urlId,
    statsData,
    scannedAt: Date.now()
  };

  await browser.storage.local.set({ latestSingleScanResult: resultObj });
  notifyUser(
    "Scan Complete",
    `Finished scanning ${urlLink}. Malicious: ${statsData.malicious}, Suspicious: ${statsData.suspicious}`,
    statsData.malicious > 0 ? "error" : statsData.suspicious > 0 ? "warning" : "info",
    8000,
    false
  );
}

async function executeFolderScan(urlLink, folderId, forceRescan = false) {
  notifyUser("Scan Started", `Scanning ${urlLink} in background...`, "info", 4000, true);

  const { folderData } = await browser.storage.local.get("folderData");
  const folders = folderData?.folders || [];
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return;

  const entry = folder.urls.find((e) => e.link === urlLink);
  if (!entry) return;

  if (!forceRescan && entry.lastScanTime && getHoursAgo(Math.floor(entry.lastScanTime / 1000)) < 12) {
    notifyUser("Skipping Scan", `${urlLink} was scanned less than 12 hours ago.`, "info", 6000, false);
    return;
  }

  const urlId = getBase64CachedUrlId(urlLink);
  const latestAnalysisJSON = await checkCachedUrlReport(urlId);
  if (!latestAnalysisJSON) return;

  let statsData;

  if (latestAnalysisJSON.notFound) {
    let requestJSON = await submitNewUrlScan(urlLink);
    if (!requestJSON || !requestJSON.data?.links?.self) {
      requestJSON = await requestURL_Rescan(urlId);
    }
    if (!requestJSON || !requestJSON.data?.links?.self) return;
    const tempJSON = await getRecentUrlReport(requestJSON.data.links.self);
    if (!tempJSON || !tempJSON.data?.attributes?.stats) return;
    statsData = tempJSON.data.attributes.stats;
  } else if (!forceRescan && latestAnalysisJSON.data?.attributes?.last_analysis_date && getHoursAgo(latestAnalysisJSON.data.attributes.last_analysis_date) < 12) {
    statsData = latestAnalysisJSON.data.attributes.last_analysis_stats;
  } else {
    const requestJSON = await requestURL_Rescan(urlId);
    if (!requestJSON || !requestJSON.data?.links?.self) return;
    const tempJSON = await getRecentUrlReport(requestJSON.data.links.self);
    if (!tempJSON || !tempJSON.data?.attributes?.stats) return;
    statsData = tempJSON.data.attributes.stats;
  }

  if (!statsData) return;

  entry.statsData = statsData;
  entry.lastScanTime = Date.now();
  await browser.storage.local.set({ folderData });

  notifyUser(
    "Scan Complete",
    `Finished scanning ${urlLink}. Malicious: ${statsData.malicious}, Suspicious: ${statsData.suspicious}`,
    statsData.malicious > 0 ? "error" : statsData.suspicious > 0 ? "warning" : "info",
    8000,
    false
  );
}

// ── Storage change listener ─────────────────────────────────────────
// Rebuild context menus when folder data changes (e.g., user creates or
// deletes a folder in the popup). This ensures the submenu stays up to date.
//
// We also rebuild when contextMenuMode changes, in case the user saved
// settings from the options page and the message was missed.
browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.folderData || changes.contextMenuMode) {
        buildContextMenu();
    }
});
