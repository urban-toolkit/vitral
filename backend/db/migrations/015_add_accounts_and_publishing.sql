-- Accounts, sessions, project ownership and publishing.
--
-- `app_users` rather than `users`: `prov_user` in 012 is a canvas-provenance node table (the
-- "person" cards on a board), and a bare `users` alongside it reads as the same thing. The prefix
-- says which side of the schema this belongs to.

CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Shown as typed; `username_lower` is what uniqueness and lookup use, so "Gustavo" and
    -- "gustavo" cannot both exist and a login is not case-sensitive.
    username TEXT NOT NULL,
    username_lower TEXT NOT NULL UNIQUE,

    -- Optional by design: an account needs a name and a password, nothing else. NULL means "not
    -- given", which is why there is no UNIQUE here — several accounts may decline to give one.
    email TEXT,

    -- scrypt, salt and parameters encoded in the string. Never a bare digest.
    password_hash TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side sessions. The cookie carries an opaque random token; only its SHA-256 is stored, so
-- a leaked database row cannot be replayed as a login.
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at);

ALTER TABLE documents
    -- NULL means "created before accounts existed". Those stay readable and editable by everyone,
    -- so an in-flight study does not lose its projects the moment login is switched on.
    -- ON DELETE SET NULL rather than CASCADE: deleting an account must not destroy research data.
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES app_users(id) ON DELETE SET NULL,

    -- Published is *visibility*, and it is reversible. It is deliberately not `review_only`, which
    -- is a permanent edit lock applied to the whole document including its owner. A published
    -- project stays editable by whoever owns it and is read-only for everybody else.
    ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS documents_owner_id_idx ON documents (owner_id);
CREATE INDEX IF NOT EXISTS documents_published_idx ON documents (published) WHERE published;
