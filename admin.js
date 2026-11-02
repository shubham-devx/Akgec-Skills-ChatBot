const elements = {
  brandField: document.querySelector("#brandField"),
  customizePanel: document.querySelector("#customizePanel"),
  customizeTab: document.querySelector("#customizeTab"),
  dashboard: document.querySelector("#dashboard"),
  descriptionField: document.querySelector("#descriptionField"),
  headlineField: document.querySelector("#headlineField"),
  loginError: document.querySelector("#loginError"),
  loginForm: document.querySelector("#loginForm"),
  loginPanel: document.querySelector("#loginPanel"),
  loginSubmit: document.querySelector("#loginSubmit"),
  logoutButton: document.querySelector("#logoutButton"),
  menuError: document.querySelector("#menuError"),
  menuForm: document.querySelector("#menuForm"),
  menuJson: document.querySelector("#menuJson"),
  menuPanel: document.querySelector("#menuPanel"),
  menuTab: document.querySelector("#menuTab"),
  saveSettings: document.querySelector("#saveSettings"),
  saveMenu: document.querySelector("#saveMenu"),
  settingsError: document.querySelector("#settingsError"),
  settingsForm: document.querySelector("#settingsForm"),
  toast: document.querySelector("#toast"),
};

let toastTimeout;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove("visible"), 3500);
}

function setError(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    credentials: "same-origin",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function showDashboard(authenticated) {
  elements.loginPanel.hidden = authenticated;
  elements.dashboard.hidden = !authenticated;
  if (authenticated) {
    loadDashboard();
  } else {
    elements.loginForm.reset();
    elements.loginError.hidden = true;
  }
}

function fillSettings(settings) {
  elements.brandField.value = settings.brandName;
  elements.headlineField.value = settings.headline;
  elements.descriptionField.value = settings.description;
  elements.menuJson.value = JSON.stringify(settings.menu, null, 2);
  const theme = elements.settingsForm.querySelector(`input[name="theme"][value="${settings.theme}"]`);
  if (theme) theme.checked = true;
}

async function loadDashboard() {
  try {
    const settingsResponse = await api("/api/config");
    fillSettings(settingsResponse);
  } catch (error) {
    showToast(`Could not load admin data: ${error.message}`);
  }
}

function setActiveTab(tab) {
  const menuActive = tab === "menu";
  elements.menuTab.classList.toggle("active", menuActive);
  elements.menuTab.setAttribute("aria-selected", String(menuActive));
  elements.customizeTab.classList.toggle("active", !menuActive);
  elements.customizeTab.setAttribute("aria-selected", String(!menuActive));
  elements.menuPanel.hidden = !menuActive;
  elements.customizePanel.hidden = menuActive;
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(elements.loginError);
  elements.loginSubmit.disabled = true;
  elements.loginSubmit.textContent = "Signing in…";
  const password = new FormData(elements.loginForm).get("password");
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
    showDashboard(true);
  } catch (error) {
    setError(elements.loginError, error.message);
  } finally {
    elements.loginSubmit.disabled = false;
    elements.loginSubmit.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
    elements.loginForm.querySelector("#adminPassword").value = "";
  }
});

elements.menuForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(elements.menuError);
  elements.saveMenu.disabled = true;
  elements.saveMenu.textContent = "Saving menu…";
  try {
    let menu;
    try {
      menu = JSON.parse(elements.menuJson.value);
    } catch (error) {
      throw new Error(`Menu JSON is invalid: ${error.message}`);
    }
    const response = await api("/api/admin/menu", {
      method: "PUT",
      body: JSON.stringify({ menu }),
    });
    elements.menuJson.value = JSON.stringify(response.menu, null, 2);
    showToast("Guided menu updated for all visitors.");
  } catch (error) {
    setError(elements.menuError, error.message);
  } finally {
    elements.saveMenu.disabled = false;
    elements.saveMenu.innerHTML = 'Save chatbot menu <span aria-hidden="true">→</span>';
  }
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(elements.settingsError);
  elements.saveSettings.disabled = true;
  elements.saveSettings.textContent = "Saving changes…";
  const formData = new FormData(elements.settingsForm);
  try {
    const response = await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        brandName: formData.get("brandName"),
        headline: formData.get("headline"),
        description: formData.get("description"),
        theme: formData.get("theme"),
      }),
    });
    fillSettings(response.settings);
    showToast("Appearance updated for all visitors.");
  } catch (error) {
    setError(elements.settingsError, error.message);
  } finally {
    elements.saveSettings.disabled = false;
    elements.saveSettings.innerHTML = 'Save appearance <span aria-hidden="true">→</span>';
  }
});

elements.logoutButton.addEventListener("click", async () => {
  elements.logoutButton.disabled = true;
  try {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
    showDashboard(false);
  } catch (error) {
    showToast(`Could not sign out: ${error.message}`);
  } finally {
    elements.logoutButton.disabled = false;
  }
});

elements.menuTab.addEventListener("click", () => setActiveTab("menu"));
elements.customizeTab.addEventListener("click", () => setActiveTab("customize"));

async function initialize() {
  try {
    const response = await api("/api/admin/session");
    showDashboard(response.authenticated);
  } catch (error) {
    showDashboard(false);
    setError(elements.loginError, `Admin service is unavailable: ${error.message}`);
  }
}

initialize();
