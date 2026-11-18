import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  publicQuestions,
  scoreAnswers,
  describe,
  findQuestion,
} from "./questions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const PLAN = {
  id: "insight",
  trialDays: 7,
  amount: 149,
  renewalAmount: 399,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "lumina.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    answers_json TEXT NOT NULL DEFAULT '{}',
    earned INTEGER,
    total INTEGER,
    iq INTEGER,
    percentile REAL,
    band_json TEXT,
    domains_json TEXT,
    name TEXT,
    email TEXT,
    amount_rub INTEGER,
    renewal_amount_rub INTEGER,
    paid_at TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    card_last4 TEXT,
    transaction_id TEXT,
    subscription_status TEXT,
    renews_at TEXT,
    cancelled_at TEXT
  );
`);

const insertSession = db.prepare(
  `INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)`
);
const selectSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
const saveAnswer = db.prepare(
  `UPDATE sessions SET answers_json = ?, updated_at = ? WHERE id = ? AND completed_at IS NULL`
);
const saveResult = db.prepare(
  `UPDATE sessions
     SET completed_at = ?, updated_at = ?, earned = ?, total = ?, iq = ?,
         percentile = ?, band_json = ?, domains_json = ?
   WHERE id = ? AND completed_at IS NULL`
);
const savePayment = db.prepare(
  `UPDATE sessions
     SET name = ?, email = ?, amount_rub = ?, renewal_amount_rub = ?,
         paid_at = ?, payment_status = 'paid', card_last4 = ?, transaction_id = ?,
         subscription_status = 'trial', renews_at = ?, updated_at = ?
   WHERE id = ? AND payment_status = 'unpaid' AND completed_at IS NOT NULL`
);
const cancelSub = db.prepare(
  `UPDATE sessions
     SET subscription_status = 'cancelled', cancelled_at = ?, updated_at = ?
   WHERE id = ? AND payment_status = 'paid' AND subscription_status = 'trial'`
);

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function present(row) {
  if (!row) return null;
  let answers = {};
  try {
    answers = JSON.parse(row.answers_json || "{}");
  } catch {
    answers = {};
  }
  const paid = row.payment_status === "paid";
  return {
    id: row.id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    completed: Boolean(row.completed_at),
    paid,
    answers,
    teaser: row.band_json ? JSON.parse(row.band_json) : null,
    payment: paid
      ? {
          amount: row.amount_rub,
          renewalAmount: row.renewal_amount_rub,
          paidAt: row.paid_at,
          last4: row.card_last4,
          transactionId: row.transaction_id,
          subscriptionStatus: row.subscription_status,
          renewsAt: row.renews_at,
          cancelledAt: row.cancelled_at,
        }
      : null,
  };
}

function presentResult(row) {
  const answers = JSON.parse(row.answers_json || "{}");
  const scored = scoreAnswers(answers);
  const band = JSON.parse(row.band_json);
  const domains = JSON.parse(row.domains_json);
  const durationSec = Math.max(
    1,
    Math.round((Date.parse(row.completed_at) - Date.parse(row.created_at)) / 1000)
  );
  return {
    ...present(row),
    name: row.name,
    email: row.email,
    iq: row.iq,
    percentile: row.percentile,
    domains,
    review: scored.review,
    narrative: describe(row.iq, band, domains),
    durationSec,
  };
}

function luhn(digits) {
  if (!/^\d{16}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i += 1) {
    let d = Number(digits[15 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function expiryOk(value) {
  const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(value || "").trim());
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  return new Date(year, month, 1) > new Date();
}

function cleanName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function validName(name) {
  return /^[\p{L}][\p{L}\s.'-]{1,79}$/u.test(name);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 120;
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32_000) {
        reject(Object.assign(new Error("Слишком большой запрос"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Не удалось прочитать запрос"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "local";
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/api/health") {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/questions") {
    send(res, 200, { questions: publicQuestions() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/session") {
    const row = await serial(async () => {
      const id = randomUUID();
      const now = new Date().toISOString();
      insertSession.run(id, now, now);
      return selectSession.get(id);
    });
    send(res, 201, present(row));
    return;
  }

  const sessionMatch =
    parts[0] === "api" && parts[1] === "session" && parts[2] && UUID_RE.test(parts[2]);

  if (!sessionMatch) {
    send(res, 404, { error: "Такого адреса нет" });
    return;
  }

  const id = parts[2];
  const action = parts[3] || "";
  const row = selectSession.get(id);
  if (!row) {
    send(res, 404, { error: "Сессия не найдена. Начните тест заново." });
    return;
  }

  if (req.method === "GET" && !action) {
    send(res, 200, present(row));
    return;
  }

  if (req.method === "GET" && action === "result") {
    if (row.payment_status !== "paid") {
      send(res, 402, { error: "Отчёт откроется после оплаты." });
      return;
    }
    send(res, 200, presentResult(row));
    return;
  }

  if (req.method === "POST" && action === "answer") {
    const body = await readBody(req);
    const question = findQuestion(body.questionId);
    if (!question || !question.options.some((o) => o.id === body.optionId)) {
      send(res, 400, { error: "Такого варианта нет." });
      return;
    }
    const updated = await serial(async () => {
      const fresh = selectSession.get(id);
      if (!fresh) return { status: 404, error: "Сессия не найдена." };
      if (fresh.completed_at) return { status: 409, error: "Тест уже отправлен, ответы закрыты." };
      const answers = JSON.parse(fresh.answers_json || "{}");
      answers[question.id] = body.optionId;
      const info = saveAnswer.run(JSON.stringify(answers), new Date().toISOString(), id);
      if (!info.changes) return { status: 409, error: "Тест уже отправлен, ответы закрыты." };
      return { status: 200, session: present(selectSession.get(id)) };
    });
    send(res, updated.status, updated.session || { error: updated.error });
    return;
  }

  if (req.method === "POST" && action === "complete") {
    const updated = await serial(async () => {
      const fresh = selectSession.get(id);
      if (!fresh) return { status: 404, error: "Сессия не найдена." };
      if (fresh.completed_at) return { status: 200, session: present(fresh) };
      const answers = JSON.parse(fresh.answers_json || "{}");
      const missing = publicQuestions().some((q) => !answers[q.id]);
      if (missing) return { status: 400, error: "Сначала ответьте на все 12 вопросов." };
      const scored = scoreAnswers(answers);
      const now = new Date().toISOString();
      const band = {
        key: scored.band.key,
        title: scored.band.title,
        detail: scored.band.detail,
      };
      const info = saveResult.run(
        now,
        now,
        scored.earned,
        scored.total,
        scored.iq,
        scored.percentile,
        JSON.stringify(band),
        JSON.stringify(scored.domains),
        id
      );
      if (!info.changes) return { status: 200, session: present(selectSession.get(id)) };
      return { status: 200, session: present(selectSession.get(id)) };
    });
    send(res, updated.status, updated.session || { error: updated.error });
    return;
  }

  if (req.method === "POST" && action === "checkout") {
    if (limited(clientIp(req))) {
      send(res, 429, { error: "Слишком много попыток. Подождите минуту." });
      return;
    }
    const body = await readBody(req);
    if (!row.completed_at) {
      send(res, 409, { error: "Сначала завершите тест." });
      return;
    }
    if (row.payment_status === "paid") {
      send(res, 200, { alreadyPaid: true, ...present(selectSession.get(id)) });
      return;
    }

    const name = cleanName(body.name);
    const email = String(body.email || "").trim().toLowerCase();
    const card = String(body.card || "").replace(/\D/g, "");
    const expiry = String(body.expiry || "");
    const cvc = String(body.cvc || "").trim();

    if (!validName(name)) {
      send(res, 400, { error: "Введите имя, как его подписать в отчёте." });
      return;
    }
    if (!validEmail(email)) {
      send(res, 400, { error: "Нужна почта в формате name@site.ru." });
      return;
    }
    if (!luhn(card)) {
      send(res, 400, {
        error: "Номер карты не проходит проверку. Для демо подойдёт 4242 4242 4242 4242.",
      });
      return;
    }
    if (!expiryOk(expiry)) {
      send(res, 400, { error: "Срок карты уже прошёл или записан не так. Пример: 12/30." });
      return;
    }
    if (!/^\d{3}$/.test(cvc)) {
      send(res, 400, { error: "CVC — это три цифры. Для демо подойдут любые, например 123." });
      return;
    }

    const last4 = card.slice(-4);
    const paid = await serial(async () => {
      const fresh = selectSession.get(id);
      if (!fresh) return { status: 404, error: "Сессия не найдена." };
      if (fresh.payment_status === "paid") {
        return { status: 200, session: { alreadyPaid: true, ...present(fresh) } };
      }
      const now = new Date();
      const renews = new Date(now.getTime() + PLAN.trialDays * 24 * 60 * 60 * 1000);
      const tx = `LUM-${randomBytes(4).toString("hex").toUpperCase()}`;
      const info = savePayment.run(
        name,
        email,
        PLAN.amount,
        PLAN.renewalAmount,
        now.toISOString(),
        last4,
        tx,
        renews.toISOString(),
        now.toISOString(),
        id
      );
      if (!info.changes) {
        const again = selectSession.get(id);
        if (again?.payment_status === "paid") {
          return { status: 200, session: { alreadyPaid: true, ...present(again) } };
        }
        return { status: 409, error: "Оплата не прошла. Завершите тест и попробуйте ещё раз." };
      }
      return { status: 200, session: present(selectSession.get(id)) };
    });
    send(res, paid.status, paid.session || { error: paid.error });
    return;
  }

  if (req.method === "POST" && action === "cancel") {
    if (row.payment_status !== "paid") {
      send(res, 402, { error: "Отменять пока нечего: отчёт не оплачен." });
      return;
    }
    await serial(async () => {
      const now = new Date().toISOString();
      cancelSub.run(now, now, id);
    });
    send(res, 200, present(selectSession.get(id)));
    return;
  }

  send(res, 404, { error: "Такого адреса нет" });
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function handleStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
  if (rel.includes("\0")) {
    send(res, 400, { error: "Плохой адрес" });
    return;
  }
  const full = path.normalize(path.join(publicDir, rel));
  if (!full.startsWith(publicDir)) {
    send(res, 403, { error: "Доступ закрыт" });
    return;
  }
  if (!existsSync(full)) {
    send(res, 404, { error: "Файл не найден" });
    return;
  }
  const ext = path.extname(full);
  const body = await readFile(full);
  res.writeHead(200, {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, { error: "Метод не поддерживается" });
      return;
    }
    await handleStatic(res, url.pathname);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    if (!res.headersSent) send(res, status, { error: error.status ? error.message : "Сбой сервера" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Lumina IQ → http://localhost:${PORT}`);
});
