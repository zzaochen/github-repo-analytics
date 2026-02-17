-- Row Level Security (RLS) Policies for GitHub Repo Analytics
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)

-- ============================================
-- STEP 1: Enable RLS on all tables
-- ============================================

ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestone_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_logs ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 2: Drop existing policies (if any)
-- ============================================

DROP POLICY IF EXISTS "Public read access" ON repositories;
DROP POLICY IF EXISTS "Authenticated write access" ON repositories;
DROP POLICY IF EXISTS "Public read access" ON daily_metrics;
DROP POLICY IF EXISTS "Authenticated write access" ON daily_metrics;
DROP POLICY IF EXISTS "Public read access" ON monthly_metrics;
DROP POLICY IF EXISTS "Authenticated write access" ON monthly_metrics;
DROP POLICY IF EXISTS "Public read access" ON milestone_events;
DROP POLICY IF EXISTS "Authenticated write access" ON milestone_events;
DROP POLICY IF EXISTS "Public read access" ON cron_logs;
DROP POLICY IF EXISTS "Authenticated write access" ON cron_logs;

-- ============================================
-- STEP 3: Create READ policies (public access)
-- Anyone can view the dashboard data
-- ============================================

CREATE POLICY "Public read access" ON repositories
  FOR SELECT
  USING (true);

CREATE POLICY "Public read access" ON daily_metrics
  FOR SELECT
  USING (true);

CREATE POLICY "Public read access" ON monthly_metrics
  FOR SELECT
  USING (true);

CREATE POLICY "Public read access" ON milestone_events
  FOR SELECT
  USING (true);

CREATE POLICY "Public read access" ON cron_logs
  FOR SELECT
  USING (true);

-- ============================================
-- STEP 4: Create WRITE policies (authenticated users only)
-- Only signed-in users can add/update/delete data
-- ============================================

-- Repositories: authenticated users can insert, update, delete
CREATE POLICY "Authenticated insert" ON repositories
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update" ON repositories
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated delete" ON repositories
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Daily metrics: authenticated users can insert, update, delete
CREATE POLICY "Authenticated insert" ON daily_metrics
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update" ON daily_metrics
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated delete" ON daily_metrics
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Monthly metrics: authenticated users can insert, update, delete
CREATE POLICY "Authenticated insert" ON monthly_metrics
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update" ON monthly_metrics
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated delete" ON monthly_metrics
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Milestone events: authenticated users can insert, update, delete
CREATE POLICY "Authenticated insert" ON milestone_events
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update" ON milestone_events
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated delete" ON milestone_events
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Cron logs: authenticated users can insert, update, delete
CREATE POLICY "Authenticated insert" ON cron_logs
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update" ON cron_logs
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated delete" ON cron_logs
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================
-- VERIFICATION: Check RLS is enabled
-- ============================================

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('repositories', 'daily_metrics', 'monthly_metrics', 'milestone_events', 'cron_logs');
