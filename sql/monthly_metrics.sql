-- Monthly metrics table for storing calculated MoM growth data
-- Run this in Supabase SQL Editor

CREATE TABLE monthly_metrics (
  id SERIAL PRIMARY KEY,
  repo_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
  month_end DATE NOT NULL,

  -- Stars metrics
  stars_at_month_end INTEGER,
  stars_mom_change INTEGER,           -- Absolute change from previous month
  stars_mom_growth_pct NUMERIC(10,2), -- Percentage growth

  -- Forks metrics
  forks_at_month_end INTEGER,
  forks_mom_change INTEGER,
  forks_mom_growth_pct NUMERIC(10,2),

  -- Issues metrics
  issues_opened_at_month_end INTEGER,
  issues_opened_mom_change INTEGER,
  issues_opened_mom_growth_pct NUMERIC(10,2),

  issues_closed_at_month_end INTEGER,
  issues_closed_mom_change INTEGER,
  issues_closed_mom_growth_pct NUMERIC(10,2),

  -- PRs metrics
  prs_opened_at_month_end INTEGER,
  prs_opened_mom_change INTEGER,
  prs_opened_mom_growth_pct NUMERIC(10,2),

  prs_merged_at_month_end INTEGER,
  prs_merged_mom_change INTEGER,
  prs_merged_mom_growth_pct NUMERIC(10,2),

  -- Contributors
  contributors_at_month_end INTEGER,
  contributors_mom_change INTEGER,
  contributors_mom_growth_pct NUMERIC(10,2),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(repo_id, month_end)
);

-- Index for faster queries
CREATE INDEX idx_monthly_metrics_repo_id ON monthly_metrics(repo_id);
CREATE INDEX idx_monthly_metrics_month_end ON monthly_metrics(month_end);

-- Optional: Add RLS policy if you have row-level security enabled
-- ALTER TABLE monthly_metrics ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all access" ON monthly_metrics FOR ALL USING (true);
