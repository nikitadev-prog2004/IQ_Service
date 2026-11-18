import postgres from "postgres";

// Answers, scores, and payment status are stored in Postgres.
// The Vercel function filesystem is read-only, so this module never creates directories or database files.

const connectionString = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();

const MISSING_URL = Object.assign(
  new Error("Не задана переменная окружения DATABASE_URL."),
  { status: 503 }
);

let startupError = null;
let sql = null;

if (connectionString) {
  try {
    sql = postgres(connectionString, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: sslSetting(connectionString),
    });
  } catch {
    console.error("postgres: строка подключения DATABASE_URL не разбирается");
    startupError = Object.assign(new Error("DATABASE_URL задан, но строка подключения неверна."), {
      status: 503,
    });
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    answers_json TEXT NOT NULL DEFAULT '{}',
    earned INTEGER,
    total INTEGER,
    iq INTEGER,
    percentile DOUBLE PRECISION,
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
  )
`;

let schemaPromise = null;

export const databaseConfigured = Boolean(sql);

function sslSetting(url) {
  if (/sslmode=disable/i.test(url)) return false;
  if (/@(localhost|127\.0\.0\.1)(:\d+)?(\/|\?|$)/.test(url)) return false;
  return "require";
}

function mapDbError(error) {
  if (error?.status) return error;
  console.error("postgres:", error?.code || "", error?.message || error);
  if (!connectionString) return MISSING_URL;
  return Object.assign(new Error("База данных недоступна. Проверьте DATABASE_URL."), { status: 503 });
}

async function ready() {
  if (startupError) throw startupError;
  if (!sql) throw MISSING_URL;
  if (!schemaPromise) {
    schemaPromise = sql.unsafe(SCHEMA).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function run(fn) {
  try {
    await ready();
    return await fn();
  } catch (error) {
    throw mapDbError(error);
  }
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

export function ping() {
  return run(() => sql`SELECT 1 AS ok`);
}

export function createSession(id, now) {
  return run(async () => {
    const rows = await sql`
      INSERT INTO sessions (id, created_at, updated_at)
      VALUES (${id}, ${now}, ${now})
      RETURNING *
    `;
    return rows[0];
  });
}

export function getSession(id) {
  return run(async () => {
    const rows = await sql`SELECT * FROM sessions WHERE id = ${id}`;
    return rows[0] || null;
  });
}

export function saveAnswer(id, questionId, optionId) {
  const now = new Date().toISOString();
  return run(() =>
    sql.begin(async (tx) => {
      const found = await tx`
        SELECT answers_json, completed_at
        FROM sessions
        WHERE id = ${id}
        FOR UPDATE
      `;
      const fresh = found[0];
      if (!fresh) return { status: 404, error: "Сессия не найдена." };
      if (fresh.completed_at) return { status: 409, error: "Тест уже отправлен, ответы закрыты." };
      const answers = parseJson(fresh.answers_json, {});
      answers[questionId] = optionId;
      const saved = await tx`
        UPDATE sessions
           SET answers_json = ${JSON.stringify(answers)}, updated_at = ${now}
         WHERE id = ${id} AND completed_at IS NULL
         RETURNING *
      `;
      if (!saved.count) return { status: 409, error: "Тест уже отправлен, ответы закрыты." };
      return { status: 200, row: saved[0] };
    })
  );
}

export function completeSession(id, assess) {
  const now = new Date().toISOString();
  return run(() =>
    sql.begin(async (tx) => {
      const found = await tx`SELECT * FROM sessions WHERE id = ${id} FOR UPDATE`;
      const fresh = found[0];
      if (!fresh) return { status: 404, error: "Сессия не найдена." };
      if (fresh.completed_at) return { status: 200, row: fresh };
      const answers = parseJson(fresh.answers_json, {});
      const scored = assess(answers);
      if (!scored) return { status: 400, error: "Сначала ответьте на все 12 вопросов." };
      const band = JSON.stringify({
        key: scored.band.key,
        title: scored.band.title,
        detail: scored.band.detail,
      });
      const saved = await tx`
        UPDATE sessions
           SET completed_at = ${now},
               updated_at = ${now},
               earned = ${scored.earned},
               total = ${scored.total},
               iq = ${scored.iq},
               percentile = ${scored.percentile},
               band_json = ${band},
               domains_json = ${JSON.stringify(scored.domains)}
         WHERE id = ${id} AND completed_at IS NULL
         RETURNING *
      `;
      return { status: 200, row: saved[0] || fresh };
    })
  );
}

export function savePayment(id, payment) {
  const now = new Date().toISOString();
  return run(() =>
    sql.begin(async (tx) => {
      const found = await tx`SELECT * FROM sessions WHERE id = ${id} FOR UPDATE`;
      const fresh = found[0];
      if (!fresh) return { status: 404, error: "Сессия не найдена." };
      if (!fresh.completed_at) return { status: 409, error: "Сначала завершите тест." };
      if (fresh.payment_status === "paid") return { status: 200, alreadyPaid: true, row: fresh };
      const saved = await tx`
        UPDATE sessions
           SET name = ${payment.name},
               email = ${payment.email},
               amount_rub = ${payment.amount},
               renewal_amount_rub = ${payment.renewalAmount},
               paid_at = ${now},
               payment_status = 'paid',
               card_last4 = ${payment.last4},
               transaction_id = ${payment.transactionId},
               subscription_status = 'trial',
               renews_at = ${payment.renewsAt},
               updated_at = ${now}
         WHERE id = ${id}
           AND payment_status = 'unpaid'
           AND completed_at IS NOT NULL
         RETURNING *
      `;
      if (!saved.count) {
        const again = await tx`SELECT * FROM sessions WHERE id = ${id}`;
        if (again[0]?.payment_status === "paid") {
          return { status: 200, alreadyPaid: true, row: again[0] };
        }
        return { status: 409, error: "Оплата не прошла. Завершите тест и попробуйте ещё раз." };
      }
      return { status: 200, row: saved[0] };
    })
  );
}

export function cancelSubscription(id) {
  const now = new Date().toISOString();
  return run(() =>
    sql.begin(async (tx) => {
      await tx`
        UPDATE sessions
           SET subscription_status = 'cancelled',
               cancelled_at = ${now},
               updated_at = ${now}
         WHERE id = ${id}
           AND payment_status = 'paid'
           AND subscription_status = 'trial'
      `;
      const rows = await tx`SELECT * FROM sessions WHERE id = ${id}`;
      return rows[0] || null;
    })
  );
}
