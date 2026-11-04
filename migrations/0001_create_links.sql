-- 短縮 URL の登録（SPEC.md §8）
CREATE TABLE links (
  slug       TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  created_at TEXT NOT NULL  -- ISO 8601（UTC）
);

CREATE INDEX links_created_at ON links (created_at DESC, slug);
