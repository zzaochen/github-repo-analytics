// BigQuery API endpoint for querying GitHub Archive data
import { BigQuery } from '@google-cloud/bigquery';

// Initialize BigQuery client with credentials from environment
function getBigQueryClient() {
  const credentials = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!credentials) {
    throw new Error('GOOGLE_CLOUD_CREDENTIALS environment variable not set');
  }

  // Support both raw JSON and base64-encoded JSON
  let parsed;
  try {
    // Try parsing as raw JSON first
    parsed = JSON.parse(credentials);
  } catch {
    // If that fails, try base64 decoding
    try {
      const decoded = Buffer.from(credentials, 'base64').toString('utf-8');
      parsed = JSON.parse(decoded);
    } catch {
      throw new Error('Invalid GOOGLE_CLOUD_CREDENTIALS format. Use raw JSON or base64-encoded JSON.');
    }
  }

  return new BigQuery({
    projectId: parsed.project_id,
    credentials: parsed
  });
}

// Preset queries for common GitHub Archive analytics
const PRESET_QUERIES = {
  commits_over_time: {
    name: 'Commits Over Time (Monthly)',
    description: 'Total push events and commits per month since 2011',
    sql: `
      SELECT
        CONCAT(EXTRACT(YEAR FROM created_at), '-', LPAD(CAST(EXTRACT(MONTH FROM created_at) AS STRING), 2, '0')) as month,
        COUNT(*) as push_events,
        SUM(CAST(JSON_EXTRACT_SCALAR(payload, '$.size') AS INT64)) as total_commits
      FROM \`githubarchive.month.*\`
      WHERE type = 'PushEvent'
        AND _TABLE_SUFFIX >= '201101'
      GROUP BY month
      ORDER BY month
    `
  },
  commits_recent_daily: {
    name: 'Daily Commits (Last 90 Days)',
    description: 'Daily commit activity for the last 90 days',
    sql: `
      SELECT
        CAST(DATE(created_at) AS STRING) as date,
        COUNT(*) as push_events,
        SUM(CAST(JSON_EXTRACT_SCALAR(payload, '$.size') AS INT64)) as total_commits
      FROM \`githubarchive.day.*\`
      WHERE type = 'PushEvent'
        AND _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY))
      GROUP BY date
      ORDER BY date
    `
  },
  top_repos_stars_month: {
    name: 'Top Starred Repos (Last 30 Days)',
    description: 'Repositories with most new stars in the last 30 days',
    sql: `
      SELECT
        repo.name,
        COUNT(*) as new_stars
      FROM \`githubarchive.day.*\`
      WHERE type = 'WatchEvent'
        AND _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
      GROUP BY repo.name
      ORDER BY new_stars DESC
      LIMIT 100
    `
  },
  language_trends: {
    name: 'Language Trends (Monthly)',
    description: 'Push events by programming language over time',
    sql: `
      SELECT
        CONCAT(EXTRACT(YEAR FROM created_at), '-', LPAD(CAST(EXTRACT(MONTH FROM created_at) AS STRING), 2, '0')) as month,
        JSON_EXTRACT_SCALAR(payload, '$.pull_request.base.repo.language') as language,
        COUNT(*) as events
      FROM \`githubarchive.month.*\`
      WHERE type = 'PullRequestEvent'
        AND JSON_EXTRACT_SCALAR(payload, '$.action') = 'opened'
        AND _TABLE_SUFFIX >= '202301'
      GROUP BY month, language
      HAVING language IS NOT NULL
      ORDER BY month, events DESC
    `
  },
  stars_over_time: {
    name: 'Stars Over Time (Monthly)',
    description: 'Total star events per month',
    sql: `
      SELECT
        CONCAT(EXTRACT(YEAR FROM created_at), '-', LPAD(CAST(EXTRACT(MONTH FROM created_at) AS STRING), 2, '0')) as month,
        COUNT(*) as stars
      FROM \`githubarchive.month.*\`
      WHERE type = 'WatchEvent'
        AND _TABLE_SUFFIX >= '201101'
      GROUP BY month
      ORDER BY month
    `
  },
  forks_over_time: {
    name: 'Forks Over Time (Monthly)',
    description: 'Total fork events per month',
    sql: `
      SELECT
        CONCAT(EXTRACT(YEAR FROM created_at), '-', LPAD(CAST(EXTRACT(MONTH FROM created_at) AS STRING), 2, '0')) as month,
        COUNT(*) as forks
      FROM \`githubarchive.month.*\`
      WHERE type = 'ForkEvent'
        AND _TABLE_SUFFIX >= '201101'
      GROUP BY month
      ORDER BY month
    `
  },
  new_repos_over_time: {
    name: 'New Repos Created (Monthly)',
    description: 'New public repositories created per month',
    sql: `
      SELECT
        CONCAT(EXTRACT(YEAR FROM created_at), '-', LPAD(CAST(EXTRACT(MONTH FROM created_at) AS STRING), 2, '0')) as month,
        COUNT(*) as new_repos
      FROM \`githubarchive.month.*\`
      WHERE type = 'CreateEvent'
        AND JSON_EXTRACT_SCALAR(payload, '$.ref_type') = 'repository'
        AND _TABLE_SUFFIX >= '201101'
      GROUP BY month
      ORDER BY month
    `
  }
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Return list of preset queries
  if (req.method === 'GET') {
    const presets = Object.entries(PRESET_QUERIES).map(([key, value]) => ({
      key,
      name: value.name,
      description: value.description
    }));
    return res.status(200).json({ presets });
  }

  // POST: Execute a query
  if (req.method === 'POST') {
    try {
      const { preset, customSql } = req.body;

      let sql;
      if (preset && PRESET_QUERIES[preset]) {
        sql = PRESET_QUERIES[preset].sql;
      } else if (customSql) {
        // Basic validation - only allow SELECT queries on githubarchive
        const normalized = customSql.trim().toLowerCase();
        if (!normalized.startsWith('select')) {
          return res.status(400).json({ error: 'Only SELECT queries are allowed' });
        }
        if (!normalized.includes('githubarchive') && !normalized.includes('github_repos')) {
          return res.status(400).json({ error: 'Queries must target githubarchive or github_repos datasets' });
        }
        sql = customSql;
      } else {
        return res.status(400).json({ error: 'Must provide preset or customSql' });
      }

      const bigquery = getBigQueryClient();
      const startTime = Date.now();

      // Create a query job and wait for results (avoids Storage Read API issues)
      const [job] = await bigquery.createQueryJob({
        query: sql,
        location: 'US',
        maximumBytesBilled: '10000000000', // 10GB limit per query
        useLegacySql: false
      });

      const [rows] = await job.getQueryResults({
        wrapIntegers: false
      });

      const elapsed = Date.now() - startTime;

      return res.status(200).json({
        success: true,
        rows,
        rowCount: rows.length,
        elapsedMs: elapsed
      });
    } catch (error) {
      console.error('BigQuery error:', error);
      return res.status(500).json({
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
