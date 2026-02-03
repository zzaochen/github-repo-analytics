# GitHub Repository Analytics Dashboard

A React dashboard that visualizes GitHub repository historical data with interactive charts and CSV export.

## Features

- **Repository Analysis**: Enter any public GitHub repository to analyze
- **Historical Data**: Fetches data from the repo's inception
- **Interactive Charts**: Stars, forks, contributors, issues, and PRs over time
- **Summary Cards**: Quick overview of key metrics
- **CSV Export**: Download all daily aggregated data
- **Supabase Caching**: Optional persistent storage for faster repeat visits

## Tech Stack

- React 18 with Vite
- Recharts for visualizations
- Tailwind CSS for styling
- Papa Parse for CSV export
- Octokit for GitHub API
- Supabase for caching (optional)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```
VITE_GITHUB_TOKEN=your_github_token
VITE_SUPABASE_URL=your_supabase_url (optional)
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key (optional)
```

3. Run the development server:
```bash
npm run dev
```

## Supabase Setup (Optional)

To enable caching, create these tables in your Supabase project:

```sql
-- Repositories table
CREATE TABLE repositories (
  id SERIAL PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_fetched TIMESTAMP,
  UNIQUE(owner, repo)
);

-- Daily metrics table
CREATE TABLE daily_metrics (
  id SERIAL PRIMARY KEY,
  repo_id INTEGER REFERENCES repositories(id),
  date DATE NOT NULL,
  total_stars INTEGER,
  total_forks INTEGER,
  total_contributors INTEGER,
  total_issues_opened INTEGER,
  total_issues_closed INTEGER,
  total_prs_opened INTEGER,
  total_prs_closed INTEGER,
  total_prs_merged INTEGER,
  UNIQUE(repo_id, date)
);
```

## Usage

1. Enter a GitHub repository in `owner/repo` format (e.g., `neondatabase/neon`)
2. Provide a GitHub personal access token
3. Wait for data to be fetched (progress indicator shows status)
4. View the interactive charts and summary metrics
5. Export data to CSV if needed

## GitHub Token

You need a GitHub personal access token for API access. Create one at:
https://github.com/settings/tokens

No special scopes are required for public repositories.
