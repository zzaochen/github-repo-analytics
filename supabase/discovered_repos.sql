-- Discovered Repos table for GitHub public repo enumeration
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)

-- Table to store discovered public GitHub repos
CREATE TABLE IF NOT EXISTS discovered_repos (
  github_id BIGINT PRIMARY KEY,  -- GitHub's repo ID (use as primary key for deduplication)
  full_name TEXT NOT NULL,        -- owner/repo
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  stars INTEGER DEFAULT 0,
  forks INTEGER DEFAULT 0,
  watchers INTEGER DEFAULT 0,
  language TEXT,
  topics TEXT[],                  -- Array of topic tags
  size_kb INTEGER DEFAULT 0,
  is_fork BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  pushed_at TIMESTAMP,
  discovered_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(full_name)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_discovered_repos_stars ON discovered_repos(stars DESC);
CREATE INDEX IF NOT EXISTS idx_discovered_repos_language ON discovered_repos(language);
CREATE INDEX IF NOT EXISTS idx_discovered_repos_created ON discovered_repos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovered_repos_discovered ON discovered_repos(discovered_at DESC);

-- Table to track collection progress
CREATE TABLE IF NOT EXISTS collection_progress (
  id SERIAL PRIMARY KEY,
  last_repo_id BIGINT NOT NULL,       -- Last GitHub repo ID processed
  repos_collected INTEGER DEFAULT 0,   -- Total repos collected in this session
  started_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  status TEXT DEFAULT 'running'        -- running, paused, completed, error
);

-- Enable RLS
ALTER TABLE discovered_repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_progress ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read access" ON discovered_repos FOR SELECT USING (true);
CREATE POLICY "Public read access" ON collection_progress FOR SELECT USING (true);

-- Public insert/update for the collection agent (runs with anon key)
CREATE POLICY "Public insert" ON discovered_repos FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON discovered_repos FOR UPDATE USING (true);
CREATE POLICY "Public insert" ON collection_progress FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON collection_progress FOR UPDATE USING (true);

-- Verify tables created
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('discovered_repos', 'collection_progress');
