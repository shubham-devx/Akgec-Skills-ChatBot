import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { get, put } from "@vercel/blob";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const scryptAsync = promisify(scrypt);
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.env.VERCEL ? tmpdir() : root, "skillmate-data"));
const dataPath = path.join(dataDirectory, "knowledge.json");
const useBlobStorage = Boolean(process.env.VERCEL || process.env.STORAGE_PROVIDER === "vercel-blob");
const blobPath = "skillmate/knowledge.json";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const maxBodyBytes = 4 * 1024 * 1024;
const maxTextBytes = 1 * 1024 * 1024;
const maxPdfBytes = 3 * 1024 * 1024;
const maxKnowledgeBytes = 25 * 1024 * 1024;
const maxDocuments = 100;
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const publicFiles = new Set(["/index.html", "/styles.css", "/app.js", "/admin.html", "/admin.css", "/admin.js", "/akgec-skills-logo.png"]);
const feedbackContextLifetimeMs = 30 * 60_000;
const feedbackExplorationRate = 0.05;
const initialRanker = {
  weights: [1.15, 0.75, 0.55, 0.2],
  bias: -0.8,
  feedbackCount: 0,
  helpfulCount: 0,
  notHelpfulCount: 0,
};
const retrievalStopWords = new Set([
  "the", "and", "for", "how", "what", "when", "where", "why", "who", "which",
  "with", "you", "can", "are", "does", "from", "about", "tell", "please",
  "your", "this", "that", "have", "want", "is", "was", "were", "will", "would",
  "could", "should", "would", "into", "our", "their", "they", "them", "its",
  "there", "here", "not", "but", "all", "any", "some", "more", "much", "many",
  "get", "give", "find", "know", "help", "explain", "show", "me", "my", "a",
  "an", "to", "of", "in", "on", "at", "by", "or", "as", "if", "do", "did",
]);
const defaultSettings = {
  brandName: "AKGEC SkillMate",
  headline: "Big goals start with one question.",
  description: "Explore skills, find your next step, and make the most of your learning journey at AKGEC.",
  theme: "violet",
};
const themes = new Set(["violet", "blue", "teal", "amber"]);
const sessions = new Map();
const loginAttempts = new Map();
const publicRequests = new Map();
const feedbackRequests = new Map();
const feedbackContexts = new Map();

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

const adminPassword = process.env.ADMIN_PASSWORD;
const validAdminPassword = adminPassword && (/^\d{9}$/.test(adminPassword) || /^[a-z]{9}$/.test(adminPassword) || adminPassword.length >= 16);
if ((!adminPassword || !validAdminPassword) && !process.env.VERCEL) {
  throw new Error("Set ADMIN_PASSWORD to exactly 9 digits, exactly 9 lowercase letters, or a passphrase of at least 16 characters. Do not put it in source code.");
}

const passwordSalt = randomBytes(16);
const passwordHash = validAdminPassword
  ? await scryptAsync(adminPassword, passwordSalt, 64)
  : null;

let data;
let saveQueue = Promise.resolve();
if (!useBlobStorage) await mkdir(dataDirectory, { recursive: true });

async function loadData() {
  if (useBlobStorage) {
    const blob = await get(blobPath, { access: "private", useCache: false });
    return blob ? JSON.parse(await new Response(blob.stream).text()) : null;
  }
  try {
    return JSON.parse(await readFile(dataPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Could not load knowledge data: ${error.message}`);
  }
}

const saved = await loadData();
if (saved) {
  data = {
    documents: Array.isArray(saved.documents) ? saved.documents : [],
    settings: { ...defaultSettings, ...(saved.settings || {}) },
    ranker: {
      ...initialRanker,
      ...(saved.ranker || {}),
      weights: Array.isArray(saved.ranker?.weights) && saved.ranker.weights.length === 4
        ? saved.ranker.weights.map((weight) => Number.isFinite(weight) ? Math.min(4, Math.max(-4, weight)) : 0)
        : [...initialRanker.weights],
    },
  };
} else {
  data = {
    documents: [],
    settings: { ...defaultSettings },
    ranker: { ...initialRanker, weights: [...initialRanker.weights] },
  };
  await saveData();
}

function safeSettings(settings) {
  return {
    brandName: settings.brandName,
    headline: settings.headline,
    description: settings.description,
    theme: settings.theme,
  };
}

async function saveData() {
  const snapshot = JSON.stringify(data);
  if (useBlobStorage) {
    const write = saveQueue.catch(() => {}).then(() => put(blobPath, snapshot, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    }));
    saveQueue = write;
    await write;
    return;
  }
  const temporaryPath = `${dataPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const write = saveQueue.catch(() => {}).then(async () => {
    await writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, dataPath);
  });
  saveQueue = write;
  await write;
}

function json(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (process.env.NODE_ENV === "production") response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function requestOriginIsSame(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.host &&
      new URL(origin).protocol === (process.env.NODE_ENV === "production" ? "https:" : "http:");
  } catch {
    return false;
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let exceededLimit = false;
    request.on("data", (chunk) => {
      if (exceededLimit) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        exceededLimit = true;
        reject(Object.assign(new Error("Request is too large."), { status: 413 }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function getClientKey(request) {
  return request.socket.remoteAddress || "unknown";
}

function checkRateLimit(map, key, limit, windowMs) {
  const now = Date.now();
  if (map.size >= 10_000 && !map.has(key)) {
    for (const [storedKey, entry] of map) {
      if (entry.resetAt <= now) map.delete(storedKey);
    }
    if (map.size >= 10_000) return false;
  }
  const current = map.get(key);
  if (!current || now >= current.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function sessionToken(request) {
  const cookie = request.headers.cookie || "";
  const entry = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("skillmate_admin="));
  if (!entry) return "";
  try {
    return decodeURIComponent(entry.slice("skillmate_admin=".length));
  } catch {
    return "";
  }
}

function isAdmin(request) {
  const token = sessionToken(request);
  const expiry = sessions.get(token);
  if (!token || !expiry || expiry <= Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  sessions.set(token, Date.now() + sessionLifetimeMs);
  return true;
}

function cookieOptions() {
  return `Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetimeMs / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

function rewardProbability(features) {
  const logit = data.ranker.bias + features.reduce((total, feature, index) => total + feature * data.ranker.weights[index], 0);
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, logit))));
}

function registerFeedbackContext(features) {
  const now = Date.now();
  for (const [id, context] of feedbackContexts) {
    if (context.expiresAt <= now) feedbackContexts.delete(id);
  }
  if (feedbackContexts.size >= 20_000) {
    const first = feedbackContexts.keys().next().value;
    if (first) feedbackContexts.delete(first);
  }
  const id = randomBytes(24).toString("base64url");
  feedbackContexts.set(id, { features, expiresAt: now + feedbackContextLifetimeMs });
  return id;
}

function updateRanker(features, rating) {
  const target = rating === "up" ? 1 : 0;
  const probability = rewardProbability(features);
  const error = target - probability;
  const learningRate = 0.18 / Math.sqrt(1 + data.ranker.feedbackCount / 20);
  data.ranker.weights = data.ranker.weights.map((weight, index) =>
    Math.min(4, Math.max(-4, weight + learningRate * error * features[index])),
  );
  data.ranker.bias = Math.min(4, Math.max(-4, data.ranker.bias + learningRate * error));
  data.ranker.feedbackCount += 1;
  if (target) data.ranker.helpfulCount += 1;
  else data.ranker.notHelpfulCount += 1;
}

function publicLearningStatus() {
  const feedbackCount = data.ranker.feedbackCount;
  return {
    feedbackCount,
    helpfulCount: data.ranker.helpfulCount,
    notHelpfulCount: data.ranker.notHelpfulCount,
    modelStatus: feedbackCount < 10 ? "Collecting feedback" : "Ranking active",
    explorationRate: feedbackCount >= 10 ? feedbackExplorationRate : 0,
  };
}

function safetyRefusal(question) {
  const sensitive = /\b(passwords?|passcodes?|api[\s_-]?keys?|access[\s_-]?tokens?|secrets?|private keys?|credentials?|confidential|classified|leaked data|system prompts?|hidden instructions|hack(?:ing)? (?:an? )?account)\b/i;
  const adult = /\b(porn(?:ography)?|xxx|nudes?|sex(?:ual)?|nsfw|erotic|fetish|masturbat(?:e|ion|ing)?|orgasm|hookups?|onlyfans)\b/i;
  return sensitive.test(question) || adult.test(question);
}

function sentenceCandidates(question) {
  const keywords = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) || [])]
    .filter((word) => !retrievalStopWords.has(word));
  if (!keywords.length) return [];
  if (keywords.length === 1 && keywords[0].length < 4) return [];
  const minMatches = keywords.length <= 2 ? 1 : Math.max(2, Math.ceil(keywords.length * 0.34));
  const normalizedQuestion = question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return data.documents.flatMap((document) =>
    document.text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => {
      const normalized = sentence.trim();
      const sentenceTokens = normalized.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
      const sentenceWords = new Set(sentenceTokens);
      const matches = keywords.filter((word) => sentenceWords.has(word) || [...sentenceWords].some((candidate) =>
        word.length >= 5 && candidate.length >= 5 && (
          candidate.startsWith(word) && candidate.length - word.length <= 3 ||
          word.startsWith(candidate) && word.length - candidate.length <= 3
        ),
      )).length;
      const normalizedSentence = normalized.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const phraseMatch = keywords.length > 1 && normalizedSentence.includes(normalizedQuestion);
      const features = [
        matches / keywords.length,
        matches / Math.max(1, sentenceWords.size),
        phraseMatch ? 1 : 0,
        Math.min(1, Math.max(0, normalized.length - 40) / 220),
      ];
      return {
        sentence: normalized.length > 900 ? `${normalized.slice(0, 897)}...` : normalized,
        matches,
        phraseMatch,
        features,
        score: rewardProbability(features),
      };
    }),
  ).filter((item) => (item.matches >= minMatches || item.phraseMatch) && item.sentence.length > 30)
    .sort((a, b) => b.score - a.score || b.matches - a.matches)
    .slice(0, 3);
}

async function extractPdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 80) throw Object.assign(new Error("PDFs must have 80 pages or fewer."), { status: 413 });
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      pages.push(text.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return pages.join("\n").trim();
  } finally {
    await task.destroy();
  }
}

function publicDocumentInfo(document) {
  return {
    id: document.id,
    name: document.name,
    type: document.type,
    createdAt: document.createdAt,
    characters: document.text.length,
  };
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/config" && request.method === "GET") {
    json(response, 200, safeSettings(data.settings));
    return true;
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    if (!checkRateLimit(publicRequests, getClientKey(request), 40, 60_000)) {
      json(response, 429, { error: "Please wait a minute before sending more questions." });
      return true;
    }
    const body = await readJson(request);
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question || question.length > 2000) {
      json(response, 400, { error: "Enter a question of 1–2,000 characters." });
      return true;
    }
    if (safetyRefusal(question)) {
      json(response, 200, { blocked: true, text: "I can’t help with requests for private credentials, secrets, or explicit adult content. I’m here to support learning and skills development." });
      return true;
    }
    const matches = sentenceCandidates(question);
    if (matches.length) {
      const exploring = data.ranker.feedbackCount >= 10 && Math.random() < feedbackExplorationRate;
      const selected = exploring && matches.length > 1
        ? matches[Math.floor(Math.random() * Math.min(matches.length, 3))]
        : matches[0];
      json(response, 200, {
        text: selected.sentence,
        feedbackId: registerFeedbackContext(selected.features),
        learningMode: "contextual-bandit",
      });
    } else {
      json(response, 200, {
        text: data.documents.length
          ? "I couldn’t find that information in the approved materials I have. Try rephrasing your question or contact the AKGEC Skills Foundation team."
          : "The AKGEC Skills Foundation team hasn’t added any approved knowledge materials yet. Please check back soon.",
        feedbackId: "",
      });
    }
    return true;
  }

  if (url.pathname === "/api/feedback" && request.method === "POST") {
    if (!requestOriginIsSame(request)) {
      json(response, 403, { error: "This feedback request was rejected." });
      return true;
    }
    if (!checkRateLimit(feedbackRequests, getClientKey(request), 30, 60_000)) {
      json(response, 429, { error: "Please wait before sending more feedback." });
      return true;
    }
    const body = await readJson(request);
    if (typeof body.feedbackId !== "string" || body.feedbackId.length > 100 || !["up", "down"].includes(body.rating)) {
      json(response, 400, { error: "This feedback could not be accepted." });
      return true;
    }
    const context = feedbackContexts.get(body.feedbackId);
    if (!context) {
      json(response, 410, { error: "This answer’s feedback window has expired. Ask the question again to rate it." });
      return true;
    }
    feedbackContexts.delete(body.feedbackId);
    updateRanker(context.features, body.rating);
    await saveData();
    json(response, 200, publicLearningStatus());
    return true;
  }

  if (!url.pathname.startsWith("/api/admin/")) return false;

  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    json(response, 200, { authenticated: isAdmin(request) });
    return true;
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    if (!passwordHash) {
      json(response, 503, { error: "Admin sign-in is disabled. Set ADMIN_PASSWORD to exactly 9 digits, exactly 9 lowercase letters, or at least 16 characters in Vercel Project Settings, then redeploy." });
      return true;
    }
    if (!requestOriginIsSame(request)) {
      json(response, 403, { error: "This login request was rejected." });
      return true;
    }
    const clientKey = getClientKey(request);
    if (!checkRateLimit(loginAttempts, clientKey, 8, 15 * 60_000)) {
      json(response, 429, { error: "Too many login attempts. Try again in 15 minutes." });
      return true;
    }
    const body = await readJson(request);
    const attempt = typeof body.password === "string" ? body.password : "";
    if (attempt.length > 256) {
      json(response, 401, { error: "The passphrase is incorrect." });
      return true;
    }
    const candidateHash = await scryptAsync(attempt, passwordSalt, 64);
    if (!timingSafeEqual(passwordHash, candidateHash)) {
      json(response, 401, { error: "The passphrase is incorrect." });
      return true;
    }
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, Date.now() + sessionLifetimeMs);
    loginAttempts.delete(clientKey);
    json(response, 200, { authenticated: true }, { "Set-Cookie": `skillmate_admin=${encodeURIComponent(token)}; ${cookieOptions()}` });
    return true;
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    if (!requestOriginIsSame(request)) {
      json(response, 403, { error: "This logout request was rejected." });
      return true;
    }
    sessions.delete(sessionToken(request));
    json(response, 200, { authenticated: false }, { "Set-Cookie": "skillmate_admin=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0" });
    return true;
  }

  if (!isAdmin(request)) {
    json(response, 401, { error: "Sign in to continue." });
    return true;
  }

  if (url.pathname === "/api/admin/documents" && request.method === "GET") {
    json(response, 200, { documents: data.documents.map(publicDocumentInfo) });
    return true;
  }

  if (url.pathname === "/api/admin/learning" && request.method === "GET") {
    json(response, 200, publicLearningStatus());
    return true;
  }

  if (url.pathname === "/api/admin/learning/reset" && request.method === "POST") {
    if (!requestOriginIsSame(request)) {
      json(response, 403, { error: "This ranking reset request was rejected." });
      return true;
    }
    data.ranker = {
      ...initialRanker,
      weights: [...initialRanker.weights],
    };
    feedbackContexts.clear();
    await saveData();
    json(response, 200, publicLearningStatus());
    return true;
  }

  if (url.pathname === "/api/admin/documents" && request.method === "POST") {
    if (!requestOriginIsSame(request)) {
      json(response, 403, { error: "This upload request was rejected." });
      return true;
    }
    if (data.documents.length >= maxDocuments) {
      json(response, 409, { error: "The knowledge base is full. Remove a document before adding another." });
      return true;
    }
    const body = await readJson(request);
    const name = typeof body.name === "string" ? path.basename(body.name.replace(/\\/g, "/")).replace(/[\u0000-\u001f]/g, "").slice(0, 120) : "";
    const type = body.type;
    if (!name || !["text", "pdf"].includes(type)) {
      json(response, 400, { error: "Provide a filename and a supported text or PDF file." });
      return true;
    }
    let text;
    if (type === "text") {
      if (typeof body.text !== "string" || Buffer.byteLength(body.text, "utf8") > maxTextBytes) {
        json(response, 413, { error: "Pasted text must be under 1 MB." });
        return true;
      }
      text = body.text.trim();
    } else {
      if (typeof body.base64 !== "string" || body.base64.length > Math.ceil(maxPdfBytes * 4 / 3) + 8) {
        json(response, 413, { error: "PDF files must be 8 MB or smaller." });
        return true;
      }
      const bytes = Buffer.from(body.base64, "base64");
      if (bytes.length > maxPdfBytes || bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        json(response, 400, { error: "The uploaded file is not a valid PDF or exceeds the 8 MB limit." });
        return true;
      }
      try {
        text = await extractPdfText(bytes);
      } catch (error) {
        console.error("Could not extract uploaded PDF text.", error);
        json(response, error.status || 400, { error: error.status ? error.message : "The PDF could not be read. Try a text-based PDF instead of a scanned image." });
        return true;
      }
    }
    if (!text) {
      json(response, 400, { error: "No searchable text was found in that file." });
      return true;
    }
    if (Buffer.byteLength(text, "utf8") > 3 * maxTextBytes) {
      json(response, 413, { error: "Extracted text is too large. Split the document into smaller files." });
      return true;
    }
    const currentKnowledgeBytes = data.documents.reduce((total, item) => total + Buffer.byteLength(item.text || "", "utf8"), 0);
    if (currentKnowledgeBytes + Buffer.byteLength(text, "utf8") > maxKnowledgeBytes) {
      json(response, 409, { error: "The knowledge base has reached its storage limit. Remove or shorten materials before adding more." });
      return true;
    }
    const document = { id: randomBytes(16).toString("hex"), name, type, text, createdAt: new Date().toISOString() };
    data.documents.push(document);
    await saveData();
    json(response, 201, { document: publicDocumentInfo(document) });
    return true;
  }

  const documentMatch = url.pathname.match(/^\/api\/admin\/documents\/([a-f0-9]{32})$/);
  if (documentMatch && request.method === "DELETE") {
    if (!requestOriginIsSame(request)) {
      json(response, 403, { error: "This delete request was rejected." });
      return true;
    }
    const originalCount = data.documents.length;
    data.documents = data.documents.filter((document) => document.id !== documentMatch[1]);
    if (data.documents.length === originalCount) {
      json(response, 404, { error: "That document was not found." });
      return true;
    }
    await saveData();
    json(response, 200, { deleted: true });
    return true;
  }

  if (url.pathname === "/api/admin/settings" && request.method === "PUT") {
    if (!requestOriginIsSame(request)) {
      json(response, 403, { error: "This settings request was rejected." });
      return true;
    }
    const body = await readJson(request);
    const brandName = typeof body.brandName === "string" ? body.brandName.trim() : "";
    const headline = typeof body.headline === "string" ? body.headline.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (brandName.length < 3 || brandName.length > 50 || headline.length < 8 || headline.length > 100 || description.length < 20 || description.length > 240 || !themes.has(body.theme)) {
      json(response, 400, { error: "Check the brand name, headline, description, and theme values." });
      return true;
    }
    data.settings = { brandName, headline, description, theme: body.theme };
    await saveData();
    json(response, 200, { settings: safeSettings(data.settings) });
    return true;
  }

  json(response, 404, { error: "Admin endpoint not found." });
  return true;
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function serveFile(request, response, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    json(response, 400, { error: "Invalid URL path." });
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/admin" || pathname === "/admin/") pathname = "/admin.html";
  if (!publicFiles.has(pathname)) {
    json(response, 404, { error: "Not found." });
    return;
  }
  const filePath = path.resolve(root, `.${pathname}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    json(response, 404, { error: "Not found." });
    return;
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      json(response, 404, { error: "Not found." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control": "no-cache",
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    json(response, 404, { error: "Not found." });
  }
}

export async function handleRequest(request, response) {
  setSecurityHeaders(response);
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      if (!await handleApi(request, response, url)) json(response, 404, { error: "API endpoint not found." });
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      json(response, 405, { error: "Method not allowed." });
      return;
    }
    await serveFile(request, response, url);
  } catch (error) {
    console.error("Request failed.", error);
    if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : "The request could not be completed." });
    else response.destroy();
  }
}

if (!process.env.VERCEL) {
  const server = createServer(handleRequest);
  const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  server.listen(port, host, () => {
    console.log(`AKGEC SkillMate is available at http://localhost:${port}`);
    console.log("Admin route: /admin. Admin passphrase is read from the ADMIN_PASSWORD environment variable.");
  });
}
