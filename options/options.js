/**
 * options.js — Runs on the extension's settings / preferences page.
 *
 * The options page is opened from about:addons → your extension → Preferences,
 * or by clicking the gear icon in the popup.
 *
 * It's a full HTML page (not a popup), so it has more room for settings UI.
 *
 * Like the popup, the options page has full access to browser.* APIs and
 * browser.storage. It does NOT have access to web page DOMs (only content
 * scripts do).
 *
 * Key pattern shown here:
 *   1. On page load → read saved settings from storage → fill the form
 *   2. On "Save" click → read the form → write to storage
 *   3. After saving contextMenuMode, send a message to the background script
 *      so it can rebuild the menus without needing a full extension reload.
 */

// ── DOM references ──────────────────────────────────────────────────
const savedUrlInput = document.getElementById("saved-url");
const btnSave = document.getElementById("btn-save");
const saveStatusEl = document.getElementById("save-status");
const apiKeyInput = document.getElementById("virustotal-api-key");
const btnToggleApiKey = document.getElementById("btn-toggle-api-key"); // Visibility for API key input

// Radio buttons for context menu mode.
// document.getElementsByName() returns all elements with a given "name"
// attribute. Radio buttons in the same group share the same name.
const modeRadios = document.getElementsByName("contextMenuMode");

// ── Load settings from storage and fill the form ────────────────────
async function loadSettings() {
    try {
        // browser.storage.local.get() takes an array of keys (or a single
        // key string) and returns an object with those keys and their values.
        // If a key doesn't exist yet, it simply won't be in the result.
        const data = await browser.storage.local.get([
            "savedUrl",
            "contextMenuMode",
            "virustotalApiKey"
        ]);

        // The "??" operator (nullish coalescing) provides a default value
        // if the stored value is null or undefined.
        // toggleEnabled.checked = data.extensionEnabled ?? true;
        // toggleAccess.checked = data.accessibleThemes ?? false;
        savedUrlInput.value = data.savedUrl ?? "";
        apiKeyInput.value = data.virusTotalApiKey ?? "";

        // Set the correct radio button to "checked" based on the saved value.
        // We loop through all radios and check the one whose value matches.
        const savedMode = data.contextMenuMode ?? "simple";
        modeRadios.forEach((radio) => {
            // radio.value is the "value" attribute from the HTML.
            // We set .checked = true on the matching radio.
            radio.checked = radio.value === savedMode;
        });
    } catch (err) {
        console.error("[options] Failed to load settings:", err);
    }
}

// ── Save settings to storage ────────────────────────────────────────
btnSave.addEventListener("click", async () => {
    try {
        // Find which radio button is currently selected.
        // Array.from() converts the NodeList from getElementsByName into
        // a real array so we can use .find() on it.
        // .find() returns the first element where the callback is true.
        const selectedRadio = Array.from(modeRadios).find((r) => r.checked);
        const contextMenuMode = selectedRadio ? selectedRadio.value : "simple";
        const virusTotalApiKey = apiKeyInput.value.trim();

        await browser.storage.local.set({
            contextMenuMode,
            virusTotalApiKey
        });

        // Notify the background script that the menu mode changed.
        // browser.runtime.sendMessage() sends a message to the background
        // script's onMessage listener. The background script will read
        // the new mode from storage and rebuild the context menus.
        //
        // We send a simple object with an "action" field so the background
        // script knows what to do. This is a common pattern in extensions.
        await browser.runtime.sendMessage({ action: "rebuildMenus" });

        saveStatusEl.textContent = "Settings saved ✓";
        setTimeout(() => {
            saveStatusEl.textContent = "";
        }, 2000);
    } catch (err) {
        saveStatusEl.textContent = "Error saving settings";
        console.error("[options] Failed to save settings:", err);
    }
});

btnToggleApiKey.addEventListener("click", () => {
    const wrapper = btnToggleApiKey.parentElement;

    if (apiKeyInput.type === "password") {
        apiKeyInput.type = "text";
        wrapper.classList.add("show-password");
    } else {
        apiKeyInput.type = "password";
        wrapper.classList.remove("show-password");
    }
})

// ── Init ────────────────────────────────────────────────────────────
loadSettings();
