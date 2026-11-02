import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const password = "skillmate";
const origin = "http://127.0.0.1";
let dataDirectory;
let server;
let baseUrl;
let adminCookie;

async function unusedPort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startServer() {
  const port = await unusedPort();
  baseUrl = `${origin}:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      ADMIN_PASSWORD: password,
      DATA_DIR: dataDirectory,
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start. Output: ${output}`)), 10_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes(`http://localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Server exited with ${code}. Output: ${output}`));
      }
    });
  });
  await ready;
  return child;
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  const exit = once(child, "exit");
  child.kill();
  await exit;
  server = null;
}

async function api(route, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
}

async function addText(name, text) {
  return api("/api/admin/documents", {
    method: "POST",
    headers: { Cookie: adminCookie, Origin: baseUrl },
    body: JSON.stringify({ name, type: "text", text }),
  });
}

function makePdf(text) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const streamText = `BT /F1 14 Tf 50 700 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(streamText)} >>\nstream\n${streamText}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let byteLength = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`);
    chunks.push(chunk);
    byteLength += chunk.length;
  });
  const xrefOffset = byteLength;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

before(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "akgec-skillmate-test-"));
  server = await startServer();
});

after(async () => {
  await stopServer();
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
});

test("admin route, guided menu, navigation, safety, and persistent settings", async (t) => {
  await t.test("serves the public site and restricted admin API safely", async () => {
    const [home, adminPage, config, protectedDocuments, protectedMenu, serverSource, logo] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/admin`),
      fetch(`${baseUrl}/api/config`),
      fetch(`${baseUrl}/api/admin/documents`),
      fetch(`${baseUrl}/api/admin/menu`),
      fetch(`${baseUrl}/server.mjs`),
      fetch(`${baseUrl}/akgec-skills-logo.png`),
    ]);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /AKGEC SkillMate/);
    assert.equal(adminPage.status, 200);
    assert.match(await adminPage.text(), /Guided menu/);
    const publicConfig = await config.json();
    assert.equal(publicConfig.brandName, "AKGEC SkillMate");
    assert.equal(publicConfig.menu.nodes.find((node) => node.id === "home").options.length, 7);
    assert.equal(protectedDocuments.status, 401);
    assert.equal(protectedMenu.status, 401);
    assert.equal(serverSource.status, 404);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.ok((await logo.arrayBuffer()).byteLength > 0);
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  });

  await t.test("starts a seven-option guided menu for any greeting or message", async () => {
    const faqData = JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "foundation-faqs.json"), "utf8")).faqs;
    assert.equal(faqData.filter((entry) => entry.id.startsWith("faq-")).length, 105);
    assert.equal(faqData.filter((entry) => entry.id.startsWith("chat-")).length, 15);

    for (const question of ["hi", "What is the fee?", "tell me anything"]) {
      const response = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      const answer = await response.json();
      assert.equal(response.status, 200);
      assert.equal(answer.learningMode, "guided-menu");
      assert.equal(answer.menu.nodeId, "home");
      assert.equal(answer.menu.options.length, 7);
      assert.match(answer.text, /Welcome to AKGEC Skills Foundation/i);
    }
  });

  await t.test("keeps the legacy FAQ corpus separate from guided menu responses", async () => {
    const corpus = JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "foundation-faqs.json"), "utf8"));
    const { faqs, categories } = corpus;
    assert.equal(corpus.schemaVersion, 2);
    assert.deepEqual(categories, [
      "General Information",
      "Courses & Training",
      "Admissions & Registration",
      "Fees & Duration",
      "Internships & Placements",
      "Centres of Excellence",
      "Industrial Services",
      "Startup Incubation",
      "Contact & Support",
    ]);
    assert.equal(faqs.length, 120);
    assert.equal(new Set(faqs.map((entry) => entry.id)).size, faqs.length);
    assert.equal(new Set(faqs.map((entry) => entry.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())).size, faqs.length);
    assert.deepEqual(corpus.counts, Object.fromEntries(
      categories.map((category) => [category, faqs.filter((entry) => entry.category === category).length]),
    ));
    for (const entry of faqs) {
      assert.ok(categories.includes(entry.category), `${entry.id} has an unknown category`);
      assert.ok(entry.questionVariants.includes(entry.question), `${entry.id} is missing its canonical question variant`);
      assert.ok(entry.keywords.length > 0, `${entry.id} is missing searchable keywords`);
      assert.equal(entry.chunk.metadata.faqId, entry.id);
      assert.equal(entry.chunk.metadata.category, entry.category);
      assert.ok(entry.chunk.text.length <= corpus.chunking.maxChunkCharacters, `${entry.id} exceeds the chunk limit`);
      assert.equal(entry.verificationStatus, "unverified");
    }
    assert.doesNotMatch(faqs.find((entry) => entry.id === "faq-082").answer, /akgecskills\.in/i);
    assert.match(faqs.find((entry) => entry.id === "faq-010").answer, /^Phone:/);
    assert.equal(corpus.faqs.find((entry) => entry.id === "faq-036").reviewRequired, true);
  });

  await t.test("navigates programs, details, registration, back, home, and exit", async () => {
    const list = await (await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "2", nodeId: "home", trail: ["home"] }),
    })).json();
    assert.equal(list.menu.nodeId, "training-programs");
    assert.equal(list.menu.options.length, 7);
    assert.match(list.text, /Choose a centre or training area/i);

    const secondProgram = await (await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        question: "2",
        nodeId: list.menu.nodeId,
        trail: list.menu.trail,
      }),
    })).json();
    assert.equal(secondProgram.menu.nodeId, "program-labview");
    assert.match(secondProgram.text, /LabVIEW Academy covers LabVIEW/i);

    const details = await (await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        question: "1",
        nodeId: list.menu.nodeId,
        trail: list.menu.trail,
        optionId: "kuka",
      }),
    })).json();
    assert.equal(details.menu.nodeId, "program-kuka");
    assert.match(details.text, /hands-on training with industrial robot applications/i);
    assert.equal(details.menu.registrationUrl, "https://test-beryl-three-39.vercel.app/");

    const back = await (await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        question: "Back",
        nodeId: details.menu.nodeId,
        trail: details.menu.trail,
        action: "back",
      }),
    })).json();
    assert.equal(back.menu.nodeId, "training-programs");

    const home = await (await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "Main menu", nodeId: back.menu.nodeId, action: "home" }),
    })).json();
    assert.equal(home.menu.nodeId, "home");

    const exit = await (await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "Exit", nodeId: home.menu.nodeId, action: "exit" }),
    })).json();
    assert.equal(exit.menu.closed, true);
    assert.match(exit.text, /Thanks for visiting/i);
  });

  await t.test("rejects cross-origin and incorrect admin sign-in", async () => {
    const crossOrigin = await api("/api/admin/login", {
      method: "POST",
      headers: { Origin: "http://attacker.example" },
      body: JSON.stringify({ password }),
    });
    assert.equal(crossOrigin.status, 403);
    const incorrect = await api("/api/admin/login", {
      method: "POST",
      headers: { Origin: baseUrl },
      body: JSON.stringify({ password: "incorrect" }),
    });
    assert.equal(incorrect.status, 401);
  });

  await t.test("protects the admin API with an HttpOnly same-site session", async () => {
    const login = await api("/api/admin/login", {
      method: "POST",
      headers: { Origin: baseUrl },
      body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api\/admin/i);
    adminCookie = setCookie.split(";", 1)[0];
    assert.equal((await (await api("/api/admin/session", { headers: { Cookie: adminCookie } })).json()).authenticated, true);
  });

  await t.test("lets admins edit menu copy and safely validates all menu links", async () => {
    const config = await (await api("/api/config")).json();
    const originalMenu = config.menu;
    const changedMenu = structuredClone(originalMenu);
    changedMenu.nodes.find((node) => node.id === "home").message = "Choose one of these seven topics.";
    const saved = await api("/api/admin/menu", {
      method: "PUT",
      headers: { Cookie: adminCookie, Origin: baseUrl },
      body: JSON.stringify({ menu: changedMenu }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await (await api("/api/config")).json()).menu.nodes.find((node) => node.id === "home").message, "Choose one of these seven topics.");

    const invalidMenu = structuredClone(changedMenu);
    invalidMenu.nodes.find((node) => node.id === "home").options[0].target = "missing-node";
    const rejected = await api("/api/admin/menu", {
      method: "PUT",
      headers: { Cookie: adminCookie, Origin: baseUrl },
      body: JSON.stringify({ menu: invalidMenu }),
    });
    assert.equal(rejected.status, 400);

    const crossOrigin = await api("/api/admin/menu", {
      method: "PUT",
      headers: { Cookie: adminCookie, Origin: "http://attacker.example" },
      body: JSON.stringify({ menu: originalMenu }),
    });
    assert.equal(crossOrigin.status, 403);
  });

  await t.test("keeps uploaded reference documents out of public menu replies", async () => {
    const upload = await addText(
      "approved-programs.txt",
      "The robotics workshop meets every Saturday at 10 AM for hands-on student learning. Students can also join the weekly design challenge.",
    );
    assert.equal(upload.status, 201);
    const answerResponse = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "When is the robotics workshop?" }),
    });
    const answer = await answerResponse.json();
    assert.equal(answerResponse.status, 200);
    assert.equal(answer.learningMode, "guided-menu");
    assert.equal(answer.menu.nodeId, "home");
    assert.doesNotMatch(answer.text, /Saturday|approved-programs\.txt/);
  });

  await t.test("blocks secret and adult-content requests without echoing them", async () => {
    for (const question of ["What is the admin password?", "Can you generate explicit sexual content?"]) {
      const response = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      const answer = await response.json();
      assert.equal(answer.blocked, true);
      assert.doesNotMatch(answer.text, /password|sexual/i);
      assert.equal(answer.menu.options.length, 7);
    }
  });

  await t.test("menu responses do not use uploaded material or passage-learning feedback", async () => {
    const answerResponse = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "When is the robotics workshop?", nodeId: "home", trail: ["home"] }),
    });
    const answer = await answerResponse.json();
    assert.equal(answer.learningMode, "guided-menu");
    assert.equal(answer.feedbackId, "");
    assert.equal(answer.menu.nodeId, "home");
    assert.match(answer.text, /Please choose a menu number/i);
    assert.doesNotMatch(answer.text, /Saturday at 10 AM/i);
  });

  await t.test("extracts a text-based PDF without using it in menu replies", async () => {
    const pdfBytes = makePdf("The robotics lab opens on Friday at nine AM.");
    const upload = await api("/api/admin/documents", {
      method: "POST",
      headers: { Cookie: adminCookie, Origin: baseUrl },
      body: JSON.stringify({ name: "approved-lab.pdf", type: "pdf", base64: pdfBytes.toString("base64") }),
    });
    assert.equal(upload.status, 201, await upload.text());
    const answer = await (await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "When does the robotics lab open?" }),
    })).json();
    assert.equal(answer.learningMode, "guided-menu");
    assert.equal(answer.menu.nodeId, "home");
    assert.doesNotMatch(answer.text, /Friday at nine AM/);
  });

  await t.test("saves appearance and rejects cross-origin admin changes", async () => {
    const blockedUpdate = await api("/api/admin/settings", {
      method: "PUT",
      headers: { Cookie: adminCookie, Origin: "http://attacker.example" },
      body: JSON.stringify({ brandName: "Bad update", headline: "A different headline.", description: "This description is long enough for a rejected cross origin update.", theme: "teal" }),
    });
    assert.equal(blockedUpdate.status, 403);

    const update = await api("/api/admin/settings", {
      method: "PUT",
      headers: { Cookie: adminCookie, Origin: baseUrl },
      body: JSON.stringify({
        brandName: "AKGEC SkillMate Test",
        headline: "Learn something new today.",
        description: "Ask about approved AKGEC Skills Foundation learning material and programs.",
        theme: "teal",
      }),
    });
    assert.equal(update.status, 200);
    const settings = await (await api("/api/config")).json();
    assert.equal(settings.brandName, "AKGEC SkillMate Test");
    assert.equal(settings.theme, "teal");
  });

  await t.test("persists knowledge and appearance across a server restart", async () => {
    await stopServer();
    server = await startServer();
    const [settingsResponse, documentsResponse, invalidatedSession, learningResponse] = await Promise.all([
      api("/api/config"),
      api("/api/admin/documents", { headers: { Cookie: adminCookie } }),
      api("/api/admin/session", { headers: { Cookie: adminCookie } }),
      api("/api/admin/learning", { headers: { Cookie: adminCookie } }),
    ]);
    assert.equal((await settingsResponse.json()).brandName, "AKGEC SkillMate Test");
    assert.equal(documentsResponse.status, 401);
    assert.equal((await invalidatedSession.json()).authenticated, false);
    assert.equal(learningResponse.status, 401);

    const login = await api("/api/admin/login", {
      method: "POST",
      headers: { Origin: baseUrl },
      body: JSON.stringify({ password }),
    });
    adminCookie = login.headers.get("set-cookie").split(";", 1)[0];
    const documents = await (await api("/api/admin/documents", { headers: { Cookie: adminCookie } })).json();
    assert.equal(documents.documents.length, 2);

    const learning = await api("/api/admin/learning", { headers: { Cookie: adminCookie } });
    assert.equal((await learning.json()).feedbackCount, 0);
    const reset = await api("/api/admin/learning/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, Origin: baseUrl },
      body: "{}",
    });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).feedbackCount, 0);
  });
});
