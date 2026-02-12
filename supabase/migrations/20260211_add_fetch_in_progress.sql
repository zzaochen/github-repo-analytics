-- Add column to track if a fetch is in progress (for resume capability)
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS fetch_in_progress BOOLEAN DEFAULT false;
