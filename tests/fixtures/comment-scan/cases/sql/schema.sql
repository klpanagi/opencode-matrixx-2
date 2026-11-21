-- Tables backing the settings service.
CREATE TABLE settings (
  id TEXT PRIMARY KEY, -- stable slug
  value TEXT NOT NULL
);
