/* AI-Review complete */

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
 *       { id: "f-1234567890", name: "Recipes",  urls: ["https://..."] },
 *       { id: "f-0987654321", name: "Work",     urls: ["https://..."] },
 *     ]
 *   }
 *
 * The "General" folder is NOT stored — it's computed on the fly by
 * combining (unioning) all URLs from every folder. This means it's
 * always up to date without needing any sync logic.
 */

/* ==========================================================================
   DOM REFERENCES
   We grab references to all the HTML elements we need to read from
   or write to. This is done once at the top so we don't have to
   repeatedly call document.getElementById() throughout the code.
   ========================================================================== */
const tabButtons = document.querySelectorAll(".tab-btn");
const panelFolders = document.getElementById("panel-folders");
// const panelImage = document.getElementById("panel-image");
const panelURL_Check = document.getElementById("panel-URL-Check");
const searchInput = document.getElementById("search-input");
const searchResultsEl = document.getElementById("search-results");
const btnTheme = document.getElementById("btn-theme");
const iconMoon = document.getElementById("icon-moon");
const iconSun = document.getElementById("icon-sun");
const btnHelp = document.getElementById("btn-help");
const btnSettings = document.getElementById("btn-settings");
const folderSidebarList = document.getElementById("folder-sidebar-list");
// const generalFolderBtn = document.querySelector(".general-folder");
const newFolderInput = document.getElementById("new-folder-input");
const btnNewFolder = document.getElementById("btn-new-folder");
const folderHeading = document.getElementById("folder-heading");
const urlListEl = document.getElementById("url-list");
const emptyFolderMsg = document.getElementById("empty-folder-msg");
const btnURL_Check = document.getElementById("btn-submit-url-check");

/* ==========================================================================
   STATE
   We keep a small amount of "in-memory state" so the popup can respond
   quickly to user actions without hitting storage on every click.
   This state is re-populated from storage every time the popup opens.
   ========================================================================== */

// The currently selected folder ID. "__general__" is a special value
// meaning the virtual General folder (union of all URLs).
// let activeFolderId = "__general__";
let activeFolderId = null;
// I can likely get rid of the general folder and set activeFolder to null for first time users.
// Then, when they create a new folder, it will auto select that folder as active and of course we can implement persistent 
// storage for the last active folder so that when the user opens the popup again, it will open to the last active folder. 

// The full folder data object loaded from storage.
// This is kept in sync with storage via loadFolderData() and saveFolderData().
let folderData = { folders: [] };

/* ==========================================================================
   INITIALISATION
   Called once when the popup opens. Loads data from storage and renders
   the initial UI state.
   ========================================================================== */
async function init() {
  // console.log("[popup] Initialising popup...");
  await loadFolderData();
  await restoreThemeState(); // Restore light/dark mode
  renderSidebar();
  renderUrlList();
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
    const result = await browser.storage.local.get("folderData");
    folderData = result.folderData || { folders: [] };
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

    // console.log(" Restoring theme state:", state);

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
  catch (err) 
  {
    if (err instanceof TypeError) 
    {// This is for fresh installs
      iconSun.classList.remove("hidden");
      iconMoon.classList.add("hidden");
    }
    else 
    {
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
  // generalFolderBtn.classList.toggle("active", activeFolderId === "__general__"); // Might need to add re-store for active folder so that it persists across popup opens

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

    // ── Folder icon (small SVG) ──
    // We set innerHTML for the icon because creating SVG elements
    // programmatically is verbose. innerHTML parses an HTML string
    // and creates the DOM nodes for us.
    const iconSpan = document.createElement("span");

    // ── Folder name ──
    const nameSpan = document.createElement("span");
    nameSpan.className = "folder-item-name";
    nameSpan.textContent = folder.name;
    // .title sets the tooltip text shown on hover — useful for seeing
    // the full name when it's truncated with "…"
    nameSpan.title = folder.name;

    // ── Delete button (red ✕ circle) ── // Could use an image instead to be more consistent with other icons
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "folder-delete-btn";
    deleteBtn.textContent = "✕";
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
function selectFolder(folderId) {
  activeFolderId = folderId;
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
    urls: [], // Starts with no URLs
  };

  // Array.push() adds the new folder to the END of the array
  folderData.folders.push(newFolder);
  await saveFolderData();

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
  // if (activeFolderId === folderId) {
  //   activeFolderId = "__general__";
  // }
  // if (activeFolderId === folderId && folder. ) {

  // }
  if (folderData.folders.at(folderIndex)) {
    activeFolderId = folderData.folders.at(folderIndex).id;
  } else if (folderData.folders.at(folderIndex - 1)) {
    activeFolderId = folderData.folders.at(folderIndex - 1).id;
  } else {
    activeFolderId = null; // No folders left
  }


  // const newFolder = {
  //   id: "f-" + Date.now(), // Unique ID
  //   name: trimmedName,
  //   urls: [], // Starts with no URLs
  // };

  // // Array.push() adds the new folder to the END of the array
  // folderData.folders.push(newFolder);

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

  let urls = [];
  // let headingText = "General";
  let headingText = "";

  // ── Specific folder: find it and show its URLs ──
  // Array.find() searches for the first matching element
  const folder = folderData.folders.find((f) => f.id === activeFolderId);
  if (folder) {
    urls = folder.urls;
    headingText = folder.name;
  }

  // if (activeFolderId === "__general__") {
  //   // ── General folder: union of all URLs ──
  //   // We use a Set to collect unique URLs, then convert back to an array.
  //   //
  //   // How this works step by step:
  //   //   1. Create an empty Set
  //   //   2. Loop through every folder, and for each URL in that folder,
  //   //      call urlSet.add(url) — duplicates are ignored automatically
  //   //   3. Spread the Set back into an array with [...urlSet]
  //   //      (the ... "spread operator" unpacks an iterable into individual values)
  //   const urlSet = new Set();
  //   folderData.folders.forEach((folder) => {
  //     folder.urls.forEach((url) => urlSet.add(url));
  //   });
  //   urls = [...urlSet];
  //   headingText = "General";
  // } else {
  //   // ── Specific folder: find it and show its URLs ──
  //   // Array.find() searches for the first matching element
  //   const folder = folderData.folders.find((f) => f.id === activeFolderId);
  //   if (folder) {
  //     urls = folder.urls;
  //     headingText = folder.name;
  //   }
  // }

  // Update the heading at the top of the main panel
  folderHeading.textContent = headingText;

  // If there are no URLs, show the empty message
  if (folderData.folders.length === 0) {
    const msg = document.createElement("p");
    msg.className = "empty-folder-msg";
    msg.textContent = "No folders created yet.";
    urlListEl.appendChild(msg);
    return;
  }
  else if (urls.length === 0) {
    const msg = document.createElement("p");
    msg.className = "empty-folder-msg";
    msg.textContent = "No URLs saved yet.";
    urlListEl.appendChild(msg);
    return;
  }

  // Create a DOM element for each URL
  urls.forEach((url) => {
    const item = document.createElement("div");
    item.className = "url-item";
    // Store the URL on the element as a data attribute so we can
    // reference it later (e.g., when searching)
    item.dataset.url = url;

    // ── Clickable link ──
    // <a> elements with an href become clickable links.
    // target="_blank" opens the link in a new tab.
    // rel="noopener noreferrer" is a security best practice — it prevents
    // the opened page from accessing our popup's window object.
    const link = document.createElement("a");
    link.className = "url-item-link";
    link.href = url;
    link.textContent = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = url; // Full URL shown as tooltip on hover

    // ── Delete button for URLs ──
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "url-delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "Remove URL";
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault(); // Don't follow the link
      e.stopPropagation(); // Don't trigger parent handlers
      deleteUrlFromFolder(url);
    });

    item.appendChild(link);
    item.appendChild(deleteBtn);
    urlListEl.appendChild(item);
  });
}

/**
 * Delete a URL from the currently active folder.
 *
 * If viewing the General folder, we remove the URL from ALL folders
 * that contain it (since General is a union view).
 *
 * Array.filter() creates a new array excluding the URL to delete.
 *
 * @param {string} url — The URL string to remove
 */
async function deleteUrlFromFolder(url) {

    // Remove from the specific active folder only
    const folder = folderData.folders.find((f) => f.id === activeFolderId);
    if (folder) {
      folder.urls = folder.urls.filter((u) => u !== url);
    }

  // if (activeFolderId === "__general__") {
  //   // Remove from ALL folders
  //   folderData.folders.forEach((folder) => {
  //     folder.urls = folder.urls.filter((u) => u !== url);
  //   });
  // } else {
  //   // Remove from the specific active folder only
  //   const folder = folderData.folders.find((f) => f.id === activeFolderId);
  //   if (folder) {
  //     folder.urls = folder.urls.filter((u) => u !== url);
  //   }
  // }

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
    folder.urls.forEach((url) => {
      if (url.toLowerCase().includes(lowerQuery)) {
        results.push({
          url: url,
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
  btn.addEventListener("click", () => {
    // Deactivate all tabs and panels
    tabButtons.forEach((b) => b.classList.remove("active"));
    Object.values(panels).forEach((p) => p.classList.remove("active"));

    // Activate the clicked tab and its corresponding panel
    btn.classList.add("active");
    const panel = panels[btn.dataset.tab];
    if (panel) panel.classList.add("active");
  });
});

// ── General folder click ────────────────────────────────────────────
// generalFolderBtn.addEventListener("click", () => {
//   selectFolder("__general__");
// });

// ── "New Folder" button ─────────────────────────────────────────────
// First click: show the text input so the user can type a folder name.
// The folder is actually CREATED when the user presses Enter in the input.
btnNewFolder.addEventListener("click", () => {
  // Toggle the hidden class on the input to show/hide it
  // console.log("btnNewFolder clicked");
  newFolderInput.classList.toggle("hidden");

  // If the input is now visible, focus it so the user can start typing
  // immediately without having to click inside it.
  if (!newFolderInput.classList.contains("hidden")) {
    // .focus() places the text cursor inside the input field
    newFolderInput.focus();
  }
});

// For now, we do not do asyn since we just want to test the button, but once we add a function for 
// retrieving result from VirusTotal API, we will need to make the function async and await the result.
// btnURL_Check.addEventListener("click", () => {
//   // const urlId = getBase64CachedUrlId("https://example.com/page");
//   latestAnalysisJSON = checkCachedUrlReport("https://example.com/page");
//   console.log(latestAnalysisJSON);
//   // console.log("meow");
//   // alert(`report id is ${latestAnalysisJSON.data.id}`);
//   // alert(`Base64 URL ID for "https://example.com/page": ${urlId}`);
//   // alert(await browser.storage.local.get("virusTotalApiKey"));
// })
// Mark listener as async so we can use await
btnURL_Check.addEventListener("click", async () => {
  try {
    const latestAnalysisJSON = await checkCachedUrlReport("https://example.com/page");
    console.log("Returned JSON:", latestAnalysisJSON);
    console.log("Latest Analysis Date:", getLocalTime(latestAnalysisJSON.data.attributes.last_analysis_date));
    getSecondsAgo(latestAnalysisJSON.data.attributes.last_analysis_date);

    if (getHoursAgo(latestAnalysisJSON.data.attributes.last_analysis_date) < 12) {
      alert(`The cached report is recent (less than 12 hours old). Last analysis was at ${getLocalTime(latestAnalysisJSON.data.attributes.last_analysis_date)}.`);
    }
    else {
      alert(`The cached report is older than 12 hours. Last analysis was at ${getLocalTime(latestAnalysisJSON.data.attributes.last_analysis_date)}.`);
    }


  } catch (err) {
    console.error("Failed to fetch report:", err);
  }
});

// First thing I want to with button is get the result in terms of hours/days since the latest analysis.

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

  // console.log(localTimeString); 
  return localTimeString;
  // Output on your device (e.g.): "7/26/2026, 6:45:31 PM" (in your local timezone)

}

function getSecondsAgo(unixTimestamp) {
  // 1. Extract the raw Unix timestamp from the VirusTotal API response
  // const unixTimestamp = response.data.attributes.date; // e.g. 1785116731
  // const ms = Date.now() - unixTimestamp;
  const currentSeconds = Math.floor(Date.now() / 1000);
  const difference = currentSeconds - unixTimestamp;

  console.log(`Difference in seconds: ${difference}`);
  console.log(`Difference in minutes: ${Math.floor(difference / 60)}`);
  console.log(`Difference in hours: ${Math.floor(difference / 3600)}`);
  console.log(`Difference in days: ${Math.floor(difference / 86400)}`);
}

function getHoursAgo(unixTimestamp) {
  // 1. Extract the raw Unix timestamp from the VirusTotal API response
  // const unixTimestamp = response.data.attributes.date; // e.g. 1785116731
  // const ms = Date.now() - unixTimestamp;
  const currentSeconds = Math.floor(Date.now() / 1000);
  const difference = currentSeconds - unixTimestamp;

  console.log(`Difference in hours: ${Math.floor(difference / 3600)}`);
  return Math.floor(difference / 3600);
}

//   // This example takes 2 seconds to run
// const start = Date.now();
// console.log(Date.now());

// console.log("starting timer...");
// // Expected output: "starting timer..."

// setTimeout(() => {
//   const ms = Date.now() - start;

//   console.log(`seconds elapsed = ${Math.floor(ms / 1000)}`);
//   // Expected output: "seconds elapsed = 2"
// }, 2000);
  // 2. Convert seconds to milliseconds and pass to Date constructor
  // const dateObject = new Date(unixTimestamp * 1000);

  // 3. Format as a readable local date and time string
  // const localTimeString = dateObject.toLocaleString();

  // console.log(localTimeString); 
  // return localTimeString;
  // Output on your device (e.g.): "7/26/2026, 6:45:31 PM" (in your local timezone)


// async function checkUrlCache(targetUrl, apiKey) {
//   // 1. Generate the VirusTotal URL ID
//   const urlId = getVirusTotalUrlId(targetUrl);

//   // 2. Call the GET /api/v3/urls/{id} endpoint
//   const response = await fetch(`https://www.virustotal.com/api/v3/urls/${urlId}`, {
//     method: "GET",
//     headers: {
//       "x-apikey": apiKey,
//       "accept": "application/json"
//     }
//   });

//   // 3. Handle response status
//   if (response.status === 200) {
//     const data = await response.json();
//     console.log("Found cached report!", data);
//     return data;
//   } else if (response.status === 404) {
//     console.log("URL not found in VirusTotal database. Needs a fresh scan.");
//     return null; // Signals that you should call POST /urls to trigger a live scan
//   } else {
//     throw new Error(`VirusTotal API Error: ${response.status}`);
//   }
// }

// function getCachedAnalysisID(targetUrl, apiKey) {
//   const urlId = getBase64CachedUrlId(targetUrl);

//   const options = {
//     method: 'POST',
//     headers: {
//       'x-apikey': 'cdde9b4bba2526230859ac68dc6669534cd881f6823690efe36600b8ea1f51fc',
//       accept: 'application/json',
//       'content-type': 'application/x-www-form-urlencoded'
//     },
//     body: new URLSearchParams({url: targetUrl})
//   };

//   fetch('https://www.virustotal.com/api/v3/urls/${urlId}', options)
//     .then(res => res.json())
//     .then(res => console.log(res))
//     .catch(err => console.error(err));
// }


async function checkCachedUrlReport(targetUrl) {
  // This function actually uses the API for retrieving the cached analsysis, not just the ID.
  const urlId = getBase64CachedUrlId(targetUrl);
  console.log(`Checking cached report for URL: ${targetUrl} (ID: ${urlId})`);
  // const apiKey = storage.getItem("virustotalApiKey"); // Retrieve the API key from storage
  const apiKey = (await browser.storage.local.get("virusTotalApiKey")).virusTotalApiKey ?? "";
  console.log(`Using VirusTotal API Key: ${apiKey}`);


  // const options = {method: 'GET', headers: {accept: 'application/json', 'x-apikey': 'apiKey'}};
  const options = {
    method: "GET",
    headers: {
      "accept": "application/json",
      "x-apikey": apiKey // Passed as variable, not 'apiKey' string
    }
  };

  
  return fetch(`https://www.virustotal.com/api/v3/urls/${urlId}`, options)
    .then(res => {return res.json()})
    .then(data => {console.log("Full JSON Output:\n" + JSON.stringify(data, null, 2));
 return data;})
    .catch(err => console.error(err));

  // return res;
}


// // Modern Industry Standard Syntax
// async function checkCachedUrlReport(targetUrl) {
//   const urlId = getBase64CachedUrlId(targetUrl);
//   const apiKey = (await browser.storage.local.get("virusTotalApiKey")).virusTotalApiKey ?? "";

//   const options = {
//     method: "GET",
//     headers: {
//       "accept": "application/json",
//       "x-apikey": apiKey
//     }
//   };

//   const response = await fetch(`https://www.virustotal.com/api/v3/urls/${urlId}`, options);
//   const data = await response.json();

//   console.log("Data inside checkCachedUrlReport:", data);
//   return data; //  Return data to the caller!
// }



// async function checkCachedUrlReport(targetUrl) {

//   // 4. Use BACKTICKS (`) for URL string interpolation
//   const response = await fetch(`https://www.virustotal.com/api/v3/urls/${urlId}`, options);

//   if (!response.ok) {
//     throw new Error(`HTTP Error! Status: ${response.status}`);
//   }

//   // 5. Parse JSON data and return it to the caller
//   const data = await response.json();
//   return data;
// }

        // await browser.storage.local.set({
        //     // extensionEnabled: toggleEnabled.checked,
        //     // accessibleThemes: toggleAccess.checked,
        //     contextMenuMode,
        //     virusTotalApiKey
        // });

  // const options = {
  //   method: 'POST',
  //   headers: {
  //     'x-apikey': 'cdde9b4bba2526230859ac68dc6669534cd881f6823690efe36600b8ea1f51fc',
  //     accept: 'application/json',
  //     'content-type': 'application/x-www-form-urlencoded'
  //   },
  //   body: new URLSearchParams({url: targetUrl})
  // };

  // fetch('https://www.virustotal.com/api/v3/urls/${urlId}', options)
  //   .then(res => res.json())
  //   .then(res => console.log(res))
  //   .catch(err => console.error(err));


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

    if ( folderData.folders.some((f) => f.name.toLowerCase() === name.trim().toLowerCase()) ) {
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
  console.log("[popup] Help button clicked — no action defined yet.");
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
  // We only care about changes to "folderData" in the "local" area
  if (areaName === "local" && changes.folderData) {
    // Update our in-memory data with the new value from storage.
    // changes.folderData.newValue contains the updated folderData object.
    folderData = changes.folderData.newValue || { folders: [] };
    renderSidebar();
    renderUrlList();
    console.log("[popup] Folder data updated from storage change.");
  }
});

/* ==========================================================================
   INIT — Kick everything off
   ========================================================================== */
init();
