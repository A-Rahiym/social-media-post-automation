BEGIN;

CREATE TABLE IF NOT EXISTS articles (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  quote TEXT,
  url TEXT NOT NULL UNIQUE,
  published_at TIMESTAMPTZ,
  status TEXT,
  post_draft TEXT,
  preview_message_id TEXT,
  post_id TEXT,
  posted_at TIMESTAMPTZ,
  embedding_hash TEXT,
  embedded_at TIMESTAMPTZ
);

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS quote TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS post_draft TEXT,
  ADD COLUMN IF NOT EXISTS preview_message_id TEXT,
  ADD COLUMN IF NOT EXISTS post_id TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS embedding_hash TEXT,
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS articles_pending_idx
  ON articles (published_at DESC NULLS LAST, id DESC)
  WHERE posted_at IS NULL AND (status IS NULL OR status = 'fetched');

CREATE INDEX IF NOT EXISTS articles_status_idx ON articles (status);

CREATE INDEX IF NOT EXISTS articles_embedding_backfill_idx
  ON articles (id)
  WHERE embedding_hash IS NULL;

COMMIT;
