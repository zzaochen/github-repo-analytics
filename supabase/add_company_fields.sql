-- Add company name and URL fields to repositories table
-- Run this in your Supabase SQL Editor

ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS company_name TEXT,
ADD COLUMN IF NOT EXISTS company_url TEXT;

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'repositories'
AND column_name IN ('company_name', 'company_url');
