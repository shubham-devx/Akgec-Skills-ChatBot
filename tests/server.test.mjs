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

test("admin route, access controls, shared knowledge, PDF ingestion, and learner answers", async (t) => {
  await t.test("serves the public site and restricted admin API safely", async () => {
    const [home, adminPage, config, protectedDocuments, serverSource, logo] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/admin`),
      fetch(`${baseUrl}/api/config`),
      fetch(`${baseUrl}/api/admin/documents`),
      fetch(`${baseUrl}/server.mjs`),
      fetch(`${baseUrl}/akgec-skills-logo.png`),
    ]);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /AKGEC SkillMate/);
    assert.equal(adminPage.status, 200);
    assert.match(await adminPage.text(), /Admin passphrase/);
    assert.equal((await config.json()).brandName, "AKGEC SkillMate");
    assert.equal(protectedDocuments.status, 401);
    assert.equal(serverSource.status, 404);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.ok((await logo.arrayBuffer()).byteLength > 0);
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
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

  await t.test("retrieves relevant approved text without exposing document sources", async () => {
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
    assert.match(answer.text, /every Saturday at 10 AM/);
    assert.equal(Object.hasOwn(answer, "source"), false);
    assert.equal(answer.text.includes("approved-programs.txt"), false);

    const unrelated = await (await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "Tell me about available scholarships" }),
    })).json();
    assert.match(unrelated.text, /couldn’t find that information/i);
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
    }
  });

  await t.test("updates passage ranking from one-time feedback without retaining learner text", async () => {
    const answerResponse = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "When is the robotics workshop?" }),
    });
    const answer = await answerResponse.json();
    assert.ok(answer.feedbackId);
    assert.equal(answer.learningMode, "contextual-bandit");

    const wrongOrigin = await api("/api/feedback", {
      method: "POST",
      headers: { Origin: "http://attacker.example" },
      body: JSON.stringify({ feedbackId: answer.feedbackId, rating: "up" }),
    });
    assert.equal(wrongOrigin.status, 403);

    const invalidRating = await api("/api/feedback", {
      method: "POST",
      headers: { Origin: baseUrl },
      body: JSON.stringify({ feedbackId: answer.feedbackId, rating: "great" }),
    });
    assert.equal(invalidRating.status, 400);

    const accepted = await api("/api/feedback", {
      method: "POST",
      headers: { Origin: baseUrl },
      body: JSON.stringify({ feedbackId: answer.feedbackId, rating: "up" }),
    });
    assert.equal(accepted.status, 200);
    const status = await accepted.json();
    assert.equal(status.feedbackCount, 1);
    assert.equal(status.helpfulCount, 1);
    assert.equal(status.notHelpfulCount, 0);

    const replay = await api("/api/feedback", {
      method: "POST",
      headers: { Origin: baseUrl },
      body: JSON.stringify({ feedbackId: answer.feedbackId, rating: "down" }),
    });
    assert.equal(replay.status, 410);

    const saved = JSON.parse(await readFile(path.join(dataDirectory, "knowledge.json"), "utf8"));
    assert.deepEqual(Object.keys(saved.ranker).sort(), ["bias", "feedbackCount", "helpfulCount", "notHelpfulCount", "weights"]);
    assert.equal(saved.ranker.feedbackCount, 1);
    assert.equal(JSON.stringify(saved.ranker).includes("When is the robotics workshop?"), false);
  });

  await t.test("extracts a text-based PDF and retrieves its content", async () => {
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
    assert.match(answer.text, /Friday at nine AM/);
    assert.equal(Object.hasOwn(answer, "source"), false);
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
    assert.equal((await learning.json()).feedbackCount, 1);
    const reset = await api("/api/admin/learning/reset", {
      method: "POST",
      headers: { Cookie: adminCookie, Origin: baseUrl },
      body: "{}",
    });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).feedbackCount, 0);
  });
});
