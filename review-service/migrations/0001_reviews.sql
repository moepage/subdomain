CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head TEXT NOT NULL,
  base TEXT NOT NULL,
  expires INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'merged', 'declined', 'error')),
  email_sent INTEGER NOT NULL DEFAULT 0,
  UNIQUE(repository, pr_number, head, base)
);
