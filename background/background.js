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
    console.log("[background] Extension installed/updated:", details.reason);

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
            contextMenuMode: "simple",
        });
        console.log("[background] Default settings saved.");
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

        console.log(
            `[background] Submenu built: ${displayedFolders.length} folders + Search`
        );
        // console.log(
        //     `[background] Submenu built: General + ${displayedFolders.length} folders + Search`
        // );
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
                } else {
                    console.log("[background] Simple menu item created.");
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
            console.log("[background] Opening picker for URL:", urlToSave);
            openPickerWindow(urlToSave);
            return;
        }

        // ── "Create New Folder…" → open picker and auto-prompt ──
        if (info.menuItemId === "save-url-new-folder") {
            console.log("[background] Opening picker to new folder for:", urlToSave);
            openPickerWindow(urlToSave, "new_folder");
            return;
        }

        // ── "General" → save to ALL folders ──
        // When the user clicks "General", we add the URL to every folder.
        // This mirrors the popup's General folder behaviour (union of all).
        // if (info.menuItemId === "save-to-general") {
        //     console.log("[background] Saving to General (all folders):", urlToSave);
        //     saveUrlToAllFolders(urlToSave);
        //     return;
        // }

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
            console.log(
                `[background] Saving to folder ${folderId}:`,
                urlToSave
            );
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
            console.log("[background] URL saved to folder:", folder.name);
        } else {
            console.log("[background] URL already in folder:", folder.name);
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
    console.log("[background] Message received:", message, "from:", sender);

    // Rebuild context menus when the user changes the menu mode in settings.
    if (message.action === "rebuildMenus") {
        buildContextMenu();
        return;
    }

    // Example: the content script or popup can ask the background to do
    // something by including an "action" property in the message.
    if (message.action === "getSettings") {
        // Return a Promise — Firefox will wait for it to resolve and then
        // send the resolved value back to the sender as the response.
        return browser.storage.local.get(["extensionEnabled", "folderData"]);
    }

    // If you don't return anything (or return undefined/false), Firefox
    // assumes you have nothing to reply with and the sender's promise
    // will resolve to undefined.
});

// ── Storage change listener ─────────────────────────────────────────
// Rebuild context menus when folder data changes (e.g., user creates or
// deletes a folder in the popup). This ensures the submenu stays up to date.
//
// We also rebuild when contextMenuMode changes, in case the user saved
// settings from the options page and the message was missed.
browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.folderData || changes.contextMenuMode) {
        console.log("[background] Storage changed, rebuilding menus.");
        buildContextMenu();
    }
});
