const STORAGE_KEY = "akgec-skillmate-chats-v1";
const MAX_STORED_CHATS = 40;
const MAX_STORED_MESSAGES = 100;

const elements = {
  aboutButton: document.querySelector("#aboutButton"),
  aboutDialog: document.querySelector("#aboutDialog"),
  aboutDone: document.querySelector("#aboutDone"),
  brandName: document.querySelector("#brandName"),
  clearHistory: document.querySelector("#clearHistory"),
  closeAbout: document.querySelector("#closeAbout"),
  closeSidebar: document.querySelector("#closeSidebar"),
  composer: document.querySelector("#composer"),
  conversation: document.querySelector("#conversation"),
  heroDescription: document.querySelector("#heroDescription"),
  heroTitle: document.querySelector("#heroTitle"),
  historyList: document.querySelector("#historyList"),
  historySearch: document.querySelector("#historySearch"),
  messageInput: document.querySelector("#messageInput"),
  messages: document.querySelector("#messages"),
  startMenu: document.querySelector("#startMenu"),
  mobileBackdrop: document.querySelector("#mobileBackdrop"),
  newChat: document.querySelector("#newChat"),
  openSidebar: document.querySelector("#openSidebar"),
  sendButton: document.querySelector("#sendButton"),
  sidebar: document.querySelector("#sidebar"),
  toast: document.querySelector("#toast"),
  timeGreeting: document.querySelector("#timeGreeting"),
  welcome: document.querySelector("#welcome"),
};

let chats = readChats();
let activeChatId = null;
let toastTimeout;
let messagePending = false;

function readChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter((chat) =>
      chat &&
      typeof chat.id === "string" &&
      typeof chat.title === "string" &&
      Array.isArray(chat.messages),
    ).map((chat) => ({
      id: chat.id,
      title: chat.title.slice(0, 100),
      messages: chat.messages.filter((message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        (message.role === "user" || typeof message.text === "string"),
      ).slice(-MAX_STORED_MESSAGES).map((message) => ({
        role: message.role,
        content: message.content.slice(0, 2000),
        text: typeof message.text === "string" ? message.text.slice(0, 5000) : "",
        timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now(),
        feedback: ["up", "down"].includes(message.feedback) ? message.feedback : null,
        feedbackId: typeof message.feedbackId === "string" ? message.feedbackId.slice(0, 100) : "",
        feedbackSubmitted: Boolean(message.feedbackSubmitted),
        feedbackPending: false,
        menu: message.menu && typeof message.menu === "object" ? message.menu : null,
      })),
    })).slice(0, MAX_STORED_CHATS);
  } catch (error) {
    console.error("Could not read saved SkillMate conversations.", error);
    return [];
  }
}

function persistChats() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch (error) {
    console.error("Could not save SkillMate conversations.", error);
    showToast("Chat history could not be saved. Check this browser's storage settings.");
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove("visible"), 3600);
}

function setTimeGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  elements.timeGreeting.textContent = `${greeting} — welcome to AKGEC Skills Foundation`;
}

function currentChat() {
  return chats.find((chat) => chat.id === activeChatId) || null;
}

function renderHistory() {
  const search = elements.historySearch.value.trim().toLowerCase();
  const filtered = chats.filter((chat) =>
    chat.title.toLowerCase().includes(search) ||
    chat.messages.some((message) => message.content.toLowerCase().includes(search)),
  );
  elements.historyList.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = chats.length ? "No conversations match your search." : "Your conversations will appear here.";
    elements.historyList.append(empty);
    return;
  }

  filtered.forEach((chat) => {
    const row = document.createElement("div");
    row.className = `history-row${chat.id === activeChatId ? " active" : ""}`;
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-label", `Open conversation: ${chat.title}`);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6a7.5 7.5 0 1 1 17-3.5Z"/><path d="M8 10h8M8 14h5"/>';
    const title = document.createElement("span");
    title.textContent = chat.title;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-delete";
    remove.setAttribute("aria-label", `Delete conversation: ${chat.title}`);
    remove.title = "Delete conversation";
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteChat(chat.id);
    });
    row.append(icon, title, remove);
    row.addEventListener("click", () => openChat(chat.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openChat(chat.id);
      }
    });
    elements.historyList.append(row);
  });
}

function currentMenu() {
  const messages = currentChat()?.messages || [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant" && messages[index].menu) return messages[index].menu;
  }
  return null;
}

function renderMenuControls(message) {
  const menu = message.menu;
  if (!menu || (!menu.closed && !Array.isArray(menu.options)) || !currentChat()) return null;
  const controls = document.createElement("div");
  controls.className = "guided-menu-controls";
  const choices = document.createElement("div");
  choices.className = "guided-menu-options";
  (menu.options || []).forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "guided-menu-option";
    const number = document.createElement("span");
    number.className = "guided-menu-number";
    number.textContent = String(index + 1);
    const label = document.createElement("span");
    label.textContent = option.label;
    button.append(number, label);
    button.addEventListener("click", () => submitMessage(`${index + 1}. ${option.label}`, {
      nodeId: menu.nodeId,
      trail: menu.trail,
      optionId: option.id,
    }));
    choices.append(button);
  });
  controls.append(choices);

  const safeExternalUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  };
  const registrationUrl = safeExternalUrl(menu.registrationUrl);
  if (registrationUrl) {
    const registration = document.createElement("a");
    registration.className = "guided-menu-link registration-link";
    registration.href = registrationUrl;
    registration.target = "_blank";
    registration.rel = "noopener noreferrer";
    registration.textContent = "Start registration ↗";
    controls.append(registration);
  }
  if (Array.isArray(menu.links)) {
    menu.links.forEach((item) => {
      const url = safeExternalUrl(item.url);
      if (!url) return;
      const link = document.createElement("a");
      link.className = "guided-menu-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${item.label} ↗`;
      controls.append(link);
    });
  }

  const navigation = document.createElement("div");
  navigation.className = "guided-menu-navigation";
  const addNavigation = (label, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => submitMessage(label, {
      nodeId: menu.nodeId,
      trail: menu.trail,
      action,
    }));
    navigation.append(button);
  };
  if (menu.closed) {
    addNavigation("Main menu", "home");
  } else {
    if (menu.canGoBack) addNavigation("← Back", "back");
    if (menu.nodeId !== "home") addNavigation("Main menu", "home");
    addNavigation("Exit", "exit");
  }
  controls.append(navigation);
  return controls;
}

function renderMessages() {
  const chat = currentChat();
  elements.messages.replaceChildren();
  elements.welcome.hidden = Boolean(chat?.messages.length);
  if (!chat) return;
  const latestMenuIndex = chat.messages.reduce((latest, message, index) =>
    message.role === "assistant" && message.menu ? index : latest, -1);

  chat.messages.forEach((message, index) => {
    const wrapper = document.createElement("article");
    wrapper.className = `message ${message.role}`;
    if (message.role === "user") {
      const body = document.createElement("div");
      body.className = "message-body";
      body.textContent = message.content;
      wrapper.append(body);
      elements.messages.append(wrapper);
      return;
    }

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "✳";
    const body = document.createElement("div");
    body.className = "message-body";
    const heading = document.createElement("div");
    heading.className = "message-heading";
    const name = document.createElement("strong");
    name.textContent = "SkillMate";
    const time = document.createElement("span");
    time.textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.timestamp));
    heading.append(name, time);

    if (message.pending) {
      const dots = document.createElement("div");
      dots.className = "typing-dots";
      dots.setAttribute("aria-label", "Finding an answer");
      dots.innerHTML = "<i></i><i></i><i></i>";
      body.append(heading, dots);
      wrapper.append(avatar, body);
      elements.messages.append(wrapper);
      return;
    }

    const text = document.createElement("div");
    text.className = "message-text";
    (message.text || "").split(/\n{2,}/).filter(Boolean).forEach((paragraph) => {
      const paragraphElement = document.createElement("p");
      paragraphElement.textContent = paragraph;
      text.append(paragraphElement);
    });
    body.append(heading, text);

    const menuControls = index === latestMenuIndex && index === chat.messages.length - 1
      ? renderMenuControls(message)
      : null;
    if (menuControls) body.append(menuControls);
    wrapper.append(avatar, body);
    elements.messages.append(wrapper);
  });
}

function renderStartMenu(menu) {
  const root = menu?.nodes?.find((node) => node.id === menu.entryNodeId);
  elements.startMenu.replaceChildren();
  if (!root) return;
  root.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-card menu-start-option";
    const number = document.createElement("span");
    number.className = "guided-menu-number";
    number.textContent = String(index + 1);
    const label = document.createElement("strong");
    label.textContent = option.label;
    button.append(number, label);
    button.addEventListener("click", () => submitMessage(`${index + 1}. ${option.label}`, {
      nodeId: root.id,
      trail: [root.id],
      optionId: option.id,
    }));
    elements.startMenu.append(button);
  });
}

function updateScreen({ scroll = false } = {}) {
  renderHistory();
  renderMessages();
  if (scroll) elements.conversation.scrollTop = elements.conversation.scrollHeight;
}

function startNewChat() {
  activeChatId = null;
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  updateScreen();
  closeSidebar();
  elements.messageInput.focus();
}

function openChat(id) {
  activeChatId = id;
  updateScreen({ scroll: true });
  closeSidebar();
}

function deleteChat(id) {
  chats = chats.filter((chat) => chat.id !== id);
  if (activeChatId === id) activeChatId = null;
  persistChats();
  updateScreen();
  showToast("Conversation deleted from this browser.");
}

function deleteAllChats() {
  if (!chats.length) {
    showToast("There is no chat history to delete.");
    return;
  }
  chats = [];
  activeChatId = null;
  persistChats();
  updateScreen();
  showToast("All chat history deleted from this browser.");
}

function titleFromMessage(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 34 ? `${normalized.slice(0, 34).trimEnd()}…` : normalized;
}

function safetyRefusal(text) {
  return /\b(passwords?|passcodes?|api[\s_-]?keys?|access[\s_-]?tokens?|secrets?|private keys?|credentials?|confidential|classified|leaked data|system prompts?|hidden instructions|hack(?:ing)? (?:an? )?account|porn(?:ography)?|xxx|nudes?|sex(?:ual)?|nsfw|erotic|fetish|masturbat(?:e|ion|ing)?|orgasm|hookups?|onlyfans)\b/i.test(text);
}

async function submitMessage(text, selection = {}) {
  const content = text.trim();
  if (!content || messagePending) return;
  if (content.length > 2000) {
    showToast("Please keep your question under 2,000 characters.");
    return;
  }

  messagePending = true;
  const previousMenu = currentMenu();
  const menuRequest = {
    nodeId: selection.nodeId ?? previousMenu?.nodeId,
    trail: selection.trail ?? previousMenu?.trail,
    optionId: selection.optionId,
    action: selection.action,
  };
  let chat = currentChat();
  if (!chat) {
    chat = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: safetyRefusal(content) ? "Safety reminder" : titleFromMessage(content),
      messages: [],
    };
    chats.unshift(chat);
    activeChatId = chat.id;
  }

  const blocked = safetyRefusal(content);
  if (!blocked) chat.messages.push({ role: "user", content, timestamp: Date.now() });
  const pendingMessage = {
    role: "assistant",
    content: "",
    text: "",
    timestamp: Date.now(),
    pending: true,
    feedbackId: "",
    feedbackSubmitted: false,
    menu: null,
  };
  chat.messages.push(pendingMessage);
  persistChats();
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  elements.sendButton.disabled = true;
  updateScreen({ scroll: true });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: content, ...menuRequest }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The answer service is unavailable.");
    pendingMessage.pending = false;
    pendingMessage.text = result.text;
    pendingMessage.feedbackId = result.feedbackId || "";
    pendingMessage.menu = result.menu || (result.blocked ? menuRequest : null);
    pendingMessage.timestamp = Date.now();
    messagePending = false;
    chats = [chat, ...chats.filter((item) => item.id !== chat.id)].slice(0, MAX_STORED_CHATS);
    persistChats();
    updateScreen({ scroll: true });
  } catch (error) {
    pendingMessage.pending = false;
    pendingMessage.text = error.message === "Failed to fetch"
        ? "I couldn’t reach the answer service just now. Please try again in a moment."
        : error.message;
    pendingMessage.menu = previousMenu;
    pendingMessage.timestamp = Date.now();
    messagePending = false;
    persistChats();
    updateScreen();
    showToast(error.message === "Failed to fetch"
      ? "Can’t reach SkillMate. Start the server with `npm start` and open its local URL."
      : error.message);
  }
}

async function loadSiteSettings() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Could not load website settings.");
    const settings = await response.json();
    elements.brandName.textContent = settings.brandName;
    elements.heroTitle.textContent = settings.headline;
    elements.heroDescription.textContent = settings.description;
    renderStartMenu(settings.menu);
    document.body.dataset.theme = settings.theme;
    document.title = `${settings.brandName} — Learn. Build. Grow.`;
  } catch (error) {
    console.error("Could not load SkillMate website settings.", error);
    showToast("Could not load the guided menu. Please refresh to try again.");
  }
}

function closeSidebar() {
  elements.sidebar.classList.remove("open");
  elements.mobileBackdrop.classList.remove("visible");
}

function toggleAbout(open) {
  if (open && !elements.aboutDialog.open) elements.aboutDialog.showModal();
  if (!open && elements.aboutDialog.open) elements.aboutDialog.close();
}

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  submitMessage(elements.messageInput.value);
});

elements.messageInput.addEventListener("input", () => {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 140)}px`;
  elements.sendButton.disabled = !elements.messageInput.value.trim();
});

elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

document.querySelectorAll(".prompt-card").forEach((button) => {
  button.addEventListener("click", () => {
    elements.messageInput.value = button.dataset.prompt || "";
    elements.messageInput.dispatchEvent(new Event("input", { bubbles: true }));
    elements.messageInput.focus();
    if (window.matchMedia("(max-width: 640px)").matches) {
      elements.messageInput.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  });
});

elements.newChat.addEventListener("click", startNewChat);
elements.clearHistory.addEventListener("click", deleteAllChats);
elements.historySearch.addEventListener("input", renderHistory);
elements.openSidebar.addEventListener("click", () => {
  elements.sidebar.classList.add("open");
  elements.mobileBackdrop.classList.add("visible");
});
elements.closeSidebar.addEventListener("click", closeSidebar);
elements.mobileBackdrop.addEventListener("click", closeSidebar);
elements.aboutButton.addEventListener("click", () => toggleAbout(true));
elements.closeAbout.addEventListener("click", () => toggleAbout(false));
elements.aboutDone.addEventListener("click", () => toggleAbout(false));
elements.aboutDialog.addEventListener("click", (event) => {
  if (event.target === elements.aboutDialog) toggleAbout(false);
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    startNewChat();
  }
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    elements.historySearch.focus();
  }
});

setTimeGreeting();
updateScreen();
loadSiteSettings();
