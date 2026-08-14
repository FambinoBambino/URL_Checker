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

const btnSave = document.getElementById("btn-save");
const saveStatusEl = document.getElementById("save-status");
const apiKeyInput = document.getElementById("virustotal-api-key");
const btnToggleApiKey = document.getElementById("btn-toggle-api-key"); // Visibility for API key input

// Radio buttons for context menu mode.
// document.getElementsByName() returns all elements with a given "name"
// attribute. Radio buttons in the same group share the same name.
const modeRadios = document.getElementsByName("contextMenuMode");

// ── Theme management ────────────────────────────────────────────────
async function loadTheme() {
    try {
        const { themeState } = await browser.storage.local.get("themeState");
        const isDark = themeState?.isDarkMode ?? true;
        document.body.classList.toggle("dark-mode", isDark);
    } catch (err) {
        console.error("[options] Failed to load theme:", err);
    }
}

// Keep theme updated in real-time if changed in popup
browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.themeState) {
        const isDark = changes.themeState.newValue?.isDarkMode ?? true;
        document.body.classList.toggle("dark-mode", isDark);
    }
});

// ── Load settings from storage and fill the form ────────────────────
async function loadSettings() {
    await loadTheme();
    try {
        // browser.storage.local.get() takes an array of keys (or a single
        // key string) and returns an object with those keys and their values.
        // If a key doesn't exist yet, it simply won't be in the result.
        const data = await browser.storage.local.get([
            "contextMenuMode",
            "virustotalApiKey"
        ]);

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
    const isPassword = apiKeyInput.type === "password";
    apiKeyInput.type = isPassword ? "text" : "password";

    const eyeIcon = btnToggleApiKey.querySelector(".icon-eye");
    const eyeOffIcon = btnToggleApiKey.querySelector(".icon-eye-off");

    if (eyeIcon && eyeOffIcon) {
        eyeIcon.style.display = isPassword ? "none" : "";
        eyeOffIcon.style.display = isPassword ? "" : "none";
    }
});

// ── Init ────────────────────────────────────────────────────────────
loadSettings();

