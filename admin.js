const elements = {
  brandField: document.querySelector("#brandField"),
  customizePanel: document.querySelector("#customizePanel"),
  customizeTab: document.querySelector("#customizeTab"),
  dashboard: document.querySelector("#dashboard"),
  descriptionField: document.querySelector("#descriptionField"),
  documentCount: document.querySelector("#documentCount"),
  documentList: document.querySelector("#documentList"),
  fileForm: document.querySelector("#fileForm"),
  fileLabel: document.querySelector("#fileLabel"),
  headlineField: document.querySelector("#headlineField"),
  knowledgeFile: document.querySelector("#knowledgeFile"),
  knowledgePanel: document.querySelector("#knowledgePanel"),
  loginError: document.querySelector("#loginError"),
  loginForm: document.querySelector("#loginForm"),
  loginPanel: document.querySelector("#loginPanel"),
  loginSubmit: document.querySelector("#loginSubmit"),
  learningError: document.querySelector("#learningError"),
  learningFeedbackCount: document.querySelector("#learningFeedbackCount"),
  learningModelStatus: document.querySelector("#learningModelStatus"),
  logoutButton: document.querySelector("#logoutButton"),
  resetLearning: document.querySelector("#resetLearning"),
  saveSettings: document.querySelector("#saveSettings"),
  settingsError: document.querySelector("#settingsError"),
  settingsForm: document.querySelector("#settingsForm"),
  textError: document.querySelector("#textError"),
  textForm: document.querySelector("#textForm"),
  textName: document.querySelector("#textName"),
  knowledgeText: document.querySelector("#knowledgeText"),
  textSubmit: document.querySelector("#textSubmit"),
  toast: document.querySelector("#toast"),
  uploadButton: document.querySelector("#uploadButton"),
  uploadError: document.querySelector("#uploadError"),
  knowledgeTab: document.querySelector("#knowledgeTab"),
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

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function renderDocuments(documents) {
  elements.documentCount.textContent = `${documents.length} ${documents.length === 1 ? "document" : "documents"}`;
  elements.documentList.replaceChildren();
  if (!documents.length) {
    const empty = document.createElement("div");
    empty.className = "empty-documents";
    empty.textContent = "No materials yet. Add verified content above to start the shared knowledge base.";
    elements.documentList.append(empty);
    return;
  }

  documents.forEach((documentInfo) => {
    const row = document.createElement("article");
    row.className = "document-row";
    const fileIcon = document.createElement("span");
    fileIcon.className = "file-icon";
    fileIcon.textContent = documentInfo.type === "pdf" ? "PDF" : "TXT";
    const details = document.createElement("div");
    details.className = "document-details";
    const name = document.createElement("strong");
    name.textContent = documentInfo.name;
    const metadata = document.createElement("span");
    metadata.textContent = `${documentInfo.characters.toLocaleString()} characters · added ${formatDate(documentInfo.createdAt)}`;
    details.append(name, metadata);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-document";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${documentInfo.name}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remove "${documentInfo.name}" from the shared knowledge base?`)) return;
      remove.disabled = true;
      try {
        await api(`/api/admin/documents/${documentInfo.id}`, { method: "DELETE" });
        await loadDocuments();
        showToast("Material removed. New questions will no longer use it.");
      } catch (error) {
        remove.disabled = false;
        showToast(error.message);
      }
    });
    row.append(fileIcon, details, remove);
    elements.documentList.append(row);
  });
}

async function loadDocuments() {
  const response = await api("/api/admin/documents");
  renderDocuments(response.documents);
}

function fillSettings(settings) {
  elements.brandField.value = settings.brandName;
  elements.headlineField.value = settings.headline;
  elements.descriptionField.value = settings.description;
  const theme = elements.settingsForm.querySelector(`input[name="theme"][value="${settings.theme}"]`);
  if (theme) theme.checked = true;
}

async function loadDashboard() {
  try {
    const [documentsResponse, settingsResponse, learningResponse] = await Promise.all([
      api("/api/admin/documents"),
      api("/api/config"),
      api("/api/admin/learning"),
    ]);
    renderDocuments(documentsResponse.documents);
    fillSettings(settingsResponse);
    renderLearning(learningResponse);
  } catch (error) {
    showToast(`Could not load admin data: ${error.message}`);
  }
}

function renderLearning(status) {
  elements.learningFeedbackCount.textContent = status.feedbackCount.toLocaleString();
  elements.learningModelStatus.textContent = status.modelStatus;
}

function setActiveTab(tab) {
  const knowledgeActive = tab === "knowledge";
  elements.knowledgeTab.classList.toggle("active", knowledgeActive);
  elements.knowledgeTab.setAttribute("aria-selected", String(knowledgeActive));
  elements.customizeTab.classList.toggle("active", !knowledgeActive);
  elements.customizeTab.setAttribute("aria-selected", String(!knowledgeActive));
  elements.knowledgePanel.hidden = !knowledgeActive;
  elements.customizePanel.hidden = knowledgeActive;
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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

elements.knowledgeFile.addEventListener("change", () => {
  elements.fileLabel.textContent = elements.knowledgeFile.files[0]?.name || "Choose a PDF, TXT, or MD file";
  setError(elements.uploadError);
});

elements.fileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(elements.uploadError);
  const file = elements.knowledgeFile.files[0];
  if (!file) {
    setError(elements.uploadError, "Choose a PDF, TXT, or MD file first.");
    return;
  }
  elements.uploadButton.disabled = true;
  elements.uploadButton.textContent = "Processing document…";
  try {
    const extension = file.name.split(".").pop().toLowerCase();
    let payload;
    if (extension === "pdf" || file.type === "application/pdf") {
      if (file.size > 8 * 1024 * 1024) throw new Error("PDF files must be 8 MB or smaller.");
      payload = { name: file.name, type: "pdf", base64: encodeBase64(new Uint8Array(await file.arrayBuffer())) };
    } else {
      if (!["txt", "md"].includes(extension) || file.size > 1024 * 1024) {
        throw new Error("Choose a .txt or .md file smaller than 1 MB.");
      }
      payload = { name: file.name, type: "text", text: await file.text() };
    }
    await api("/api/admin/documents", { method: "POST", body: JSON.stringify(payload) });
    elements.fileForm.reset();
    elements.fileLabel.textContent = "Choose a PDF, TXT, or MD file";
    await loadDocuments();
    showToast("Material added to the shared knowledge base.");
  } catch (error) {
    setError(elements.uploadError, error.message);
  } finally {
    elements.uploadButton.disabled = false;
    elements.uploadButton.innerHTML = 'Add to knowledge base <span aria-hidden="true">→</span>';
  }
});

elements.textForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(elements.textError);
  elements.textSubmit.disabled = true;
  elements.textSubmit.textContent = "Adding approved text…";
  try {
    await api("/api/admin/documents", {
      method: "POST",
      body: JSON.stringify({
        name: elements.textName.value.trim(),
        type: "text",
        text: elements.knowledgeText.value,
      }),
    });
    elements.textForm.reset();
    await loadDocuments();
    showToast("Approved text added to the shared knowledge base.");
  } catch (error) {
    setError(elements.textError, error.message);
  } finally {
    elements.textSubmit.disabled = false;
    elements.textSubmit.textContent = "Add approved text";
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

elements.resetLearning.addEventListener("click", async () => {
  if (!window.confirm("Reset the passage-ranking model to its starting settings? This does not delete documents or chat history.")) return;
  elements.resetLearning.disabled = true;
  setError(elements.learningError);
  try {
    const status = await api("/api/admin/learning/reset", { method: "POST", body: "{}" });
    renderLearning(status);
    showToast("Passage ranking reset. Learner history was not changed.");
  } catch (error) {
    setError(elements.learningError, error.message);
  } finally {
    elements.resetLearning.disabled = false;
  }
});

elements.knowledgeTab.addEventListener("click", () => setActiveTab("knowledge"));
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
