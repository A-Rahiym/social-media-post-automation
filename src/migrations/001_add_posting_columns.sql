ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'fetched',
  -- fetched | previewed | approved | posted | rejected | skipped
  ADD COLUMN IF NOT EXISTS post_draft TEXT,
  ADD COLUMN IF NOT EXISTS preview_message_id TEXT,
  ADD COLUMN IF NOT EXISTS post_id TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles (status);