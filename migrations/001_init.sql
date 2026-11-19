CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS answers (
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, question_id)
);

CREATE TABLE IF NOT EXISTS results (
  session_id UUID PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
  earned INTEGER NOT NULL,
  total INTEGER NOT NULL,
  iq INTEGER NOT NULL,
  percentile DOUBLE PRECISION NOT NULL,
  band_json JSONB NOT NULL,
  domains_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  session_id UUID PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  amount_rub INTEGER NOT NULL,
  renewal_amount_rub INTEGER NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid')),
  card_last4 TEXT NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
  transaction_id TEXT NOT NULL UNIQUE,
  subscription_status TEXT NOT NULL CHECK (subscription_status IN ('trial', 'cancelled')),
  renews_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ
);
