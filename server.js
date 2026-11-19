import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { publicQuestions, scoreAnswers, describe, findQuestion } from "./questions.js";
import * as db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
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

function asJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function present(row) {
  if (!row) return null;
  const answers = asJson(row.answers_json, {});
  const paid = row.payment_status === "paid";
  const band = asJson(row.band_json, null);
  return {
    id: row.id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    completed: Boolean(row.completed_at),
    paid,
    answers,
    teaser: band,
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
  const answers = asJson(row.answers_json, {});
  const scored = scoreAnswers(answers);
  const band = asJson(row.band_json, null);
  const domains = asJson(row.domains_json, []);
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

export function parseJsonBody(text) {
  const raw = String(text || "");
  if (Buffer.byteLength(raw) > 32_000) {
    const error = new Error("Слишком большой запрос");
    error.status = 413;
    throw error;
  }
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      const error = new Error("Не удалось прочитать запрос");
      error.status = 400;
      throw error;
    }
    return value;
  } catch (error) {
    if (error.status) throw error;
    const wrapped = new Error("Не удалось прочитать запрос");
    wrapped.status = 400;
    throw wrapped;
  }
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
      try {
        resolve(parseJsonBody(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
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

function reply(status, data) {
  return { status, data };
}

export async function handleApiRequest({ method, url, body, ip }) {
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "GET" && url.pathname === "/api/health") {
    await db.ping();
    return reply(200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/questions") {
    return reply(200, { questions: publicQuestions() });
  }

  if (method === "POST" && url.pathname === "/api/session") {
    const id = randomUUID();
    const now = new Date().toISOString();
    const row = await db.createSession(id, now);
    return reply(201, present(row));
  }

  const sessionMatch = parts[0] === "api" && parts[1] === "session" && parts[2] && UUID_RE.test(parts[2]);
  if (!sessionMatch) return reply(404, { error: "Такого адреса нет" });

  const id = parts[2];
  const action = parts[3] || "";
  const row = await db.getSession(id);
  if (!row) return reply(404, { error: "Сессия не найдена. Начните тест заново." });

  if (method === "GET" && !action) return reply(200, present(row));

  if (method === "GET" && action === "result") {
    if (row.payment_status !== "paid") return reply(402, { error: "Отчёт откроется после оплаты." });
    return reply(200, presentResult(row));
  }

  if (method === "POST" && action === "answer") {
    const question = findQuestion(body?.questionId);
    if (!question || !question.options.some((option) => option.id === body?.optionId)) {
      return reply(400, { error: "Такого варианта нет." });
    }
    const saved = await db.saveAnswer(id, question.id, body.optionId, new Date().toISOString());
    if (saved.code === "missing") return reply(404, { error: "Сессия не найдена." });
    if (saved.code === "closed") return reply(409, { error: "Тест уже отправлен, ответы закрыты." });
    return reply(200, present(saved.row));
  }

  if (method === "POST" && action === "complete") {
    const finished = await db.completeSession(
      id,
      publicQuestions().map((question) => question.id),
      new Date().toISOString(),
      scoreAnswers
    );
    if (finished.code === "missing") return reply(404, { error: "Сессия не найдена." });
    if (finished.code === "incomplete") return reply(400, { error: "Сначала ответьте на все 12 вопросов." });
    return reply(200, present(finished.row));
  }

  if (method === "POST" && action === "checkout") {
    if (limited(ip || "local")) return reply(429, { error: "Слишком много попыток. Подождите минуту." });
    if (!row.completed_at) return reply(409, { error: "Сначала завершите тест." });
    if (row.payment_status === "paid") return reply(200, { alreadyPaid: true, ...present(row) });

    const name = cleanName(body?.name);
    const email = String(body?.email || "").trim().toLowerCase();
    const card = String(body?.card || "").replace(/\D/g, "");
    const expiry = String(body?.expiry || "");
    const cvc = String(body?.cvc || "").trim();

    if (!validName(name)) return reply(400, { error: "Введите имя, как его подписать в отчёте." });
    if (!validEmail(email)) return reply(400, { error: "Нужна почта в формате name@site.ru." });
    if (!luhn(card)) {
      return reply(400, {
        error: "Номер карты не проходит проверку. Для демо подойдёт 4242 4242 4242 4242.",
      });
    }
    if (!expiryOk(expiry)) {
      return reply(400, { error: "Срок карты уже прошёл или записан не так. Пример: 12/30." });
    }
    if (!/^\d{3}$/.test(cvc)) {
      return reply(400, { error: "CVC — это три цифры. Для демо подойдут любые, например 123." });
    }

    const now = new Date();
    const renews = new Date(now.getTime() + PLAN.trialDays * 24 * 60 * 60 * 1000);
    const paid = await db.recordPayment(id, {
      name,
      email,
      amount: PLAN.amount,
      renewalAmount: PLAN.renewalAmount,
      paidAt: now.toISOString(),
      renewsAt: renews.toISOString(),
      last4: card.slice(-4),
      transactionId: `LUM-${randomBytes(4).toString("hex").toUpperCase()}`,
    });
    if (paid.code === "missing") return reply(404, { error: "Сессия не найдена." });
    if (paid.code === "open") return reply(409, { error: "Оплата не прошла. Завершите тест и попробуйте ещё раз." });
    if (paid.code === "paid") return reply(200, { alreadyPaid: true, ...present(paid.row) });
    return reply(200, present(paid.row));
  }

  if (method === "POST" && action === "cancel") {
    if (row.payment_status !== "paid") return reply(402, { error: "Отменять пока нечего: отчёт не оплачен." });
    const cancelled = await db.cancelRenewal(id, new Date().toISOString());
    if (cancelled.code === "missing") return reply(404, { error: "Сессия не найдена." });
    if (cancelled.code === "unpaid") return reply(402, { error: "Отменять пока нечего: отчёт не оплачен." });
    return reply(200, present(cancelled.row));
  }

  return reply(404, { error: "Такого адреса нет" });
}

function send(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(payload);
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
  const full = path.resolve(publicDir, rel);
  const root = path.resolve(publicDir);
  if (full !== root && !full.startsWith(root + path.sep)) {
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

function clientFailure(error) {
  if (error?.publicMessage) return { status: error.status || 503, error: error.publicMessage };
  if (error?.status && error.status < 500) return { status: error.status, error: error.message };
  console.error(db.redact(error));
  return { status: 500, error: "Сбой сервера" };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      let body;
      if (req.method !== "GET" && req.method !== "HEAD") body = await readBody(req);
      const result = await handleApiRequest({
        method: req.method || "GET",
        url,
        body,
        ip: clientIp(req),
      });
      send(res, result.status, result.data);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, { error: "Метод не поддерживается" });
      return;
    }
    await handleStatic(res, url.pathname);
  } catch (error) {
    const failure = clientFailure(error);
    if (!res.headersSent) send(res, failure.status, { error: failure.error });
  }
});

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
}

if (isDirectRun()) {
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Порт ${PORT} уже занят. Остановите другой процесс или задайте другой PORT.`);
      process.exit(1);
    }
    console.error(db.redact(error));
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Lumina IQ → http://localhost:${PORT}`);
  });
}
