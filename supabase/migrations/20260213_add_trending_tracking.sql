-- Add columns to track trending discovery
ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS discovered_via_trending BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS trending_discovered_at TIMESTAMP;

-- Create a cron_logs table to track job runs
CREATE TABLE IF NOT EXISTS cron_logs (
  id SERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  run_at TIMESTAMP NOT NULL,
  trending_count INTEGER,
  new_repos_count INTEGER,
  fetched_count INTEGER,
  errors JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for querying cron logs by job name
CREATE INDEX IF NOT EXISTS idx_cron_logs_job_name ON cron_logs(job_name);
CREATE INDEX IF NOT EXISTS idx_cron_logs_run_at ON cron_logs(run_at DESC);
