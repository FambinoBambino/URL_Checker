/**
 * picker.js — Runs inside the folder picker popup window.
 *
 * This page opens when the user right-clicks on a page or link and
 * selects "Save URL to folder…" from the context menu.
 *
 * HOW IT WORKS:
 *   1. The background script opens this page with the URL-to-save passed
 *      as a query parameter: picker.html?url=https://example.com
 *   2. This script reads that query parameter to know WHAT URL to save
 *   3. It loads the folder list from browser.storage.local
 *   4. The user clicks a folder → the URL is appended to that folder → window closes
 *
 * KEY CONCEPT — Query Parameters:
 *   When a URL has a "?" followed by "key=value" pairs, those are query
 *   parameters. JavaScript can read them with the URLSearchParams API:
 *     new URLSearchParams(window.location.search).get("url")
 *   This is how we pass data from the background script to this page
 *   without needing browser.runtime.sendMessage().
 */

// ── DOM references ──────────────────────────────────────────────────
const urlPreview = document.getElementById("url-preview");
const pickerSearch = document.getElementById("picker-search");
const folderListEl = document.getElementById("folder-list");
const noFoldersEl  = document.getElementById("no-folders");
const btnCancel    = document.getElementById("btn-cancel");
const btnNewFolder = document.getElementById("btn-new-folder");

// ── Read the URL to save from the query string ──────────────────────
// window.location.search gives something like "?url=https%3A%2F%2F..."
// URLSearchParams parses it into a nice key-value map.
// .get("url") retrieves the value for the "url" key.
// decodeURIComponent is handled automatically by URLSearchParams.
const params = new URLSearchParams(window.location.search);
const urlToSave = params.get("url");

// Show the URL being saved so the user can confirm it's the right one
urlPreview.textContent = urlToSave || "(no URL provided)";

// ── Search / filter folders ─────────────────────────────────────────
// The "input" event fires on every keystroke, paste, or deletion.
// We loop through all folder buttons and hide any whose text
// doesn't contain the search query (case-insensitive).
pickerSearch.addEventListener("input", () => {
    const query = pickerSearch.value.toLowerCase();
    const buttons = folderListEl.querySelectorAll(".folder-pick-btn");

    buttons.forEach((btn) => {
        // btn.textContent gives us the visible text of the button (the folder name).
        // .toLowerCase() makes the comparison case-insensitive.
        // .includes(query) checks if the folder name contains the search text.
        const matches = btn.textContent.toLowerCase().includes(query);
        // Set display to "" (default) if it matches, or "none" to hide it.
        btn.style.display = matches ? "" : "none";
    });
});

// ── Theme management ────────────────────────────────────────────────
async function applyTheme() {
    try {
        const { themeState } = await browser.storage.local.get("themeState");
        const isDark = themeState?.isDarkMode ?? false;
        document.body.classList.toggle("dark-mode", isDark);
    } catch (err) {
        console.error("[picker] Failed to apply theme:", err);
    }
}

browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.themeState) {
        const isDark = changes.themeState.newValue?.isDarkMode ?? false;
        document.body.classList.toggle("dark-mode", isDark);
    }
});

// ── Load folders from storage and build the UI ──────────────────────
async function loadFolders() {
    try {
        // Retrieve the folderData object from storage.
        // browser.storage.local.get() returns an object with the requested keys.
        // We destructure it to pull out folderData directly.
        const { folderData } = await browser.storage.local.get("folderData");

        // folderData might be undefined if storage was cleared or this is a
        // fresh install that somehow missed the onInstalled initialisation.
        const folders = folderData?.folders || [];

        if (folders.length === 0) {
            // Show the "no folders" message and hide the folder list
            noFoldersEl.classList.remove("hidden");
            return;
        }

        // Build one button per folder
        folders.forEach((folder) => {
            // document.createElement() creates a new HTML element in memory.
            // It doesn't appear on the page until we append it to a parent.
            const btn = document.createElement("button");
            btn.className = "folder-pick-btn";

            const iconImg = document.createElement("img");
            iconImg.src = "../icons/folder/tabler--folder-16.png";
            iconImg.className = "folder-icon-img";
            iconImg.alt = "";

            const nameSpan = document.createElement("span");
            nameSpan.textContent = folder.name;

            btn.appendChild(iconImg);
            btn.appendChild(nameSpan);

            // Store the folder ID on the button so we know which folder was picked.
            // dataset.folderId maps to the HTML attribute data-folder-id.
            btn.dataset.folderId = folder.id;

            // When clicked, save the URL to this folder
            btn.addEventListener("click", () => saveUrlToFolder(folder.id));

            // Append the button to the folder list container in the DOM.
            // appendChild() adds it as the last child of the parent element.
            folderListEl.appendChild(btn);
        });
    } catch (err) {
        console.error("[picker] Failed to load folders:", err);
        noFoldersEl.textContent = "Error loading folders.";
        noFoldersEl.classList.remove("hidden");
    }
}

// ── Save the URL to the chosen folder ───────────────────────────────
async function saveUrlToFolder(folderId) {
    try {
        const { folderData } = await browser.storage.local.get("folderData");
        const folders = folderData?.folders || [];

        // Array.find() searches the array and returns the first element
        // where the callback returns true. If no match, it returns undefined.
        const folder = folders.find((f) => f.id === folderId);

        if (!folder) {
            console.error("[picker] Folder not found:", folderId);
            return;
        }

        // Array.includes() checks if the array already contains the value.
        // We don't want to save duplicate URLs in the same folder.
        if (!folder.urls.some((entry) => entry.link === urlToSave)) {
            // folder.urls.push({ link: urlToSave, scanData: null });
            folder.urls.push({ link: urlToSave, statsData: null, lastScanTime: null });

            // Write the updated folderData back to storage.
            await browser.storage.local.set({ folderData });
        } else {
            console.log("[picker] URL already exists in folder:", folder.name);
        }

        // Close this popup window.
        // window.close() tells the browser to close the current window/tab.
        window.close();
    } catch (err) {
        console.error("[picker] Failed to save URL:", err);
    }
}

// ── Cancel button → just close the window ───────────────────────────
btnCancel.addEventListener("click", () => {
    window.close();
});

// ── Create New Folder ───────────────────────────────────────────────
btnNewFolder.addEventListener("click", () => promptForNewFolder());

/**
 * Prompts the user for a folder name. If valid, creates the folder,
 * saves the current URL inside it, and closes the window.
 */
function promptForNewFolder() {
    const name = prompt("Enter a name for the new folder:");
    // If user clicked cancel or entered nothing, do nothing
    if (!name || !name.trim()) return;

    createNewFolderAndSave(name.trim());
}

/**
 * Generates a newly created folder object, appends it to storage,
 * injects the current URL, and then closes the popup.
 */
async function createNewFolderAndSave(folderName) {
    try {
        const { folderData } = await browser.storage.local.get("folderData");
        const data = folderData || { folders: [] };

        const newFolder = {
            // Generate a simple unique ID using the current timestamp
            id: "f-" + Date.now(),
            name: folderName,
            // Pre-seed this folder's URL list with the current URL
            // urls: [{ link: urlToSave, scanData: null }]
            urls: [{ link: urlToSave, statsData: null, lastScanTime: null }]
        };

        data.folders.push(newFolder);
        await browser.storage.local.set({ folderData: data });

        window.close();
    } catch (err) {
        console.error("[picker] Failed to create folder:", err);
    }
}

// ── Init ────────────────────────────────────────────────────────────
async function init() {
    await applyTheme();
    await loadFolders();

    // The background script can pass ?action=new_folder to tell the picker
    // to instantly prompt the user for a folder name as soon as it opens.
    // If the user cancels the prompt, they just stay on the picker window.
    if (params.get("action") === "new_folder") {
        promptForNewFolder();
    }
}

init();
