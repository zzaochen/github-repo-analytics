-- Add total_commits column to daily_metrics table
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)

-- Add the column (nullable with default 0)
ALTER TABLE daily_metrics
ADD COLUMN IF NOT EXISTS total_commits INTEGER DEFAULT 0;

-- Verify the column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'daily_metrics'
AND column_name = 'total_commits';
