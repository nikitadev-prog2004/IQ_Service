import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_ID = "001_init";
const MIGRATION_FILE = path.join(__dirname, "migrations", "001_init.sql");
const ADVISORY_LOCK = 815301;

let sql = null;
let schemaReady = null;

export function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (typeof value !== "string") return "";
  return value.trim();
}

export function redact(error) {
  const code = error?.code ? String(error.code) : "";
  let message = String(error?.message || error || "");
  message = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
  message = message.replace(/password=\S+/gi, "password=***");
  if (message.length > 400) message = `${message.slice(0, 400)}…`;
  return [code, message].filter(Boolean).join(" ");
}

function publicDbError(message) {
  const error = new Error(message);
  error.status = 503;
  error.publicMessage = message;
  return error;
}

function normalizeUrl(url) {
  return url
    .replace(/([?&])channel_binding=[^&]*/gi, "$1")
    .replace(/\?&/, "?")
    .replace(/[?&]$/, "");
}

function sslOption(url) {
  if (/sslmode=disable/i.test(url)) return false;
  if (/@(localhost|127\.0\.0\.1)(:\d+)?(\/|\?|$)/i.test(url) && !/sslmode=require/i.test(url)) {
    return false;
  }
  return "require";
}

export function getSql() {
  if (sql) return sql;
  const url = databaseUrl();
  if (!url) {
    throw publicDbError("База не настроена. Добавьте DATABASE_URL в переменные окружения.");
  }
  try {
    const connectionString = normalizeUrl(url);
    sql = postgres(connectionString, {
      ssl: sslOption(connectionString),
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      connection: { application_name: "lumina-iq" },
    });
  } catch (error) {
    console.error("postgres:", redact(error));
    throw publicDbError("Строка DATABASE_URL не подходит для подключения.");
  }
  return sql;
}

function splitSql(text) {
  return text
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("--"));
}

export async function migrate() {
  const db = getSql();
  const text = readFileSync(MIGRATION_FILE, "utf8");
  const statements = splitSql(text);
  if (!statements.length) {
    throw publicDbError("Файл миграции пуст.");
  }
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK})`;
    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const applied = await tx`SELECT id FROM schema_migrations WHERE id = ${MIGRATION_ID}`;
    if (applied.length) return;
    for (const statement of statements) {
      await tx.unsafe(statement);
    }
    await tx`INSERT INTO schema_migrations (id) VALUES (${MIGRATION_ID})`;
  });
}

export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = migrate().catch((error) => {
      schemaReady = null;
      if (error?.publicMessage) throw error;
      console.error("postgres:", redact(error));
      throw publicDbError("Не удалось подготовить таблицы. Проверьте DATABASE_URL и выполните npm run migrate.");
    });
  }
  return schemaReady;
}

async function withDb(fn) {
  try {
    await ensureSchema();
    return await fn(getSql());
  } catch (error) {
    if (error?.publicMessage || (error?.status && error.status < 500)) throw error;
    console.error("postgres:", redact(error));
    throw publicDbError("База данных временно недоступна.");
  }
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function asObject(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    completed_at: iso(row.completed_at),
    answers_json: asObject(row.answers, {}),
    earned: row.earned == null ? null : Number(row.earned),
    total: row.total == null ? null : Number(row.total),
    iq: row.iq == null ? null : Number(row.iq),
    percentile: row.percentile == null ? null : Number(row.percentile),
    band_json: row.band_json == null ? null : asObject(row.band_json, null),
    domains_json: row.domains_json == null ? null : asObject(row.domains_json, null),
    name: row.name || null,
    email: row.email || null,
    amount_rub: row.amount_rub == null ? null : Number(row.amount_rub),
    renewal_amount_rub: row.renewal_amount_rub == null ? null : Number(row.renewal_amount_rub),
    paid_at: iso(row.paid_at),
    payment_status: row.payment_status || "unpaid",
    card_last4: row.card_last4 || null,
    transaction_id: row.transaction_id || null,
    subscription_status: row.subscription_status || null,
    renews_at: iso(row.renews_at),
    cancelled_at: iso(row.cancelled_at),
  };
}

async function selectSession(tx, id) {
  const rows = await tx`
    SELECT
      s.id,
      s.created_at,
      s.updated_at,
      s.completed_at,
      COALESCE(
        (
          SELECT jsonb_object_agg(a.question_id, a.option_id)
          FROM answers a
          WHERE a.session_id = s.id
        ),
        '{}'::jsonb
      ) AS answers,
      r.earned,
      r.total,
      r.iq,
      r.percentile,
      r.band_json,
      r.domains_json,
      p.name,
      p.email,
      p.amount_rub,
      p.renewal_amount_rub,
      p.paid_at,
      COALESCE(p.payment_status, 'unpaid') AS payment_status,
      p.card_last4,
      p.transaction_id,
      p.subscription_status,
      p.renews_at,
      p.cancelled_at
    FROM sessions s
    LEFT JOIN results r ON r.session_id = s.id
    LEFT JOIN payments p ON p.session_id = s.id
    WHERE s.id = ${id}::uuid
  `;
  return mapSession(rows[0]);
}

export function createSession(id, now) {
  return withDb(async (db) => {
    await db`
      INSERT INTO sessions (id, created_at, updated_at)
      VALUES (${id}::uuid, ${now}, ${now})
    `;
    return selectSession(db, id);
  });
}

export function getSession(id) {
  return withDb((db) => selectSession(db, id));
}

export function ping() {
  return withDb(async (db) => {
    await db`SELECT 1`;
  });
}

export function saveAnswer(id, questionId, optionId, now) {
  return withDb((db) =>
    db.begin(async (tx) => {
      const locked = await tx`
        SELECT completed_at FROM sessions WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (!locked.length) return { code: "missing" };
      if (locked[0].completed_at) return { code: "closed" };
      await tx`
        INSERT INTO answers (session_id, question_id, option_id, updated_at)
        VALUES (${id}::uuid, ${questionId}, ${optionId}, ${now})
        ON CONFLICT (session_id, question_id)
        DO UPDATE SET option_id = EXCLUDED.option_id, updated_at = EXCLUDED.updated_at
      `;
      await tx`UPDATE sessions SET updated_at = ${now} WHERE id = ${id}::uuid`;
      return { code: "ok", row: await selectSession(tx, id) };
    })
  );
}

export function completeSession(id, questionIds, now, score) {
  return withDb((db) =>
    db.begin(async (tx) => {
      const locked = await tx`
        SELECT completed_at FROM sessions WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (!locked.length) return { code: "missing" };
      if (locked[0].completed_at) return { code: "ok", row: await selectSession(tx, id) };
      const answerRows = await tx`
        SELECT question_id, option_id FROM answers WHERE session_id = ${id}::uuid
      `;
      const answers = Object.fromEntries(answerRows.map((row) => [row.question_id, row.option_id]));
      if (questionIds.some((questionId) => !answers[questionId])) return { code: "incomplete" };
      const scored = score(answers);
      const band = {
        key: scored.band.key,
        title: scored.band.title,
        detail: scored.band.detail,
      };
      await tx`
        INSERT INTO results (
          session_id, earned, total, iq, percentile, band_json, domains_json, created_at
        )
        VALUES (
          ${id}::uuid,
          ${scored.earned},
          ${scored.total},
          ${scored.iq},
          ${scored.percentile},
          ${tx.json(band)},
          ${tx.json(scored.domains)},
          ${now}
        )
        ON CONFLICT (session_id) DO NOTHING
      `;
      await tx`
        UPDATE sessions
        SET completed_at = COALESCE(completed_at, ${now}), updated_at = ${now}
        WHERE id = ${id}::uuid
      `;
      return { code: "ok", row: await selectSession(tx, id) };
    })
  );
}

export function recordPayment(id, payment) {
  return withDb((db) =>
    db.begin(async (tx) => {
      const locked = await tx`
        SELECT completed_at FROM sessions WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (!locked.length) return { code: "missing" };
      if (!locked[0].completed_at) return { code: "open" };
      const existing = await tx`
        SELECT session_id FROM payments WHERE session_id = ${id}::uuid
      `;
      if (existing.length) return { code: "paid", row: await selectSession(tx, id) };
      const inserted = await tx`
        INSERT INTO payments (
          session_id, name, email, amount_rub, renewal_amount_rub, paid_at,
          payment_status, card_last4, transaction_id, subscription_status, renews_at
        )
        VALUES (
          ${id}::uuid,
          ${payment.name},
          ${payment.email},
          ${payment.amount},
          ${payment.renewalAmount},
          ${payment.paidAt},
          'paid',
          ${payment.last4},
          ${payment.transactionId},
          'trial',
          ${payment.renewsAt}
        )
        ON CONFLICT (session_id) DO NOTHING
        RETURNING session_id
      `;
      if (!inserted.length) return { code: "paid", row: await selectSession(tx, id) };
      await tx`UPDATE sessions SET updated_at = ${payment.paidAt} WHERE id = ${id}::uuid`;
      return { code: "ok", row: await selectSession(tx, id) };
    })
  );
}

export function cancelRenewal(id, now) {
  return withDb((db) =>
    db.begin(async (tx) => {
      const locked = await tx`
        SELECT id FROM sessions WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (!locked.length) return { code: "missing" };
      const payment = await tx`
        SELECT payment_status FROM payments WHERE session_id = ${id}::uuid FOR UPDATE
      `;
      if (!payment.length) return { code: "unpaid" };
      await tx`
        UPDATE payments
        SET subscription_status = 'cancelled', cancelled_at = ${now}
        WHERE session_id = ${id}::uuid
          AND payment_status = 'paid'
          AND subscription_status = 'trial'
      `;
      return { code: "ok", row: await selectSession(tx, id) };
    })
  );
}

export async function closeDb() {
  if (!sql) return;
  const current = sql;
  sql = null;
  schemaReady = null;
  await current.end({ timeout: 5 });
}
