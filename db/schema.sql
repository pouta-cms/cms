DROP TABLE IF EXISTS documents;

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    content_json TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    repo_branch TEXT NOT NULL,
    github_installation_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, slug, repo_owner, repo_name)
);
