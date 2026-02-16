// Vercel Cron Job: Refresh all cached repos to today
// Runs weekly on Sundays at 9 PM EST (2:00 AM UTC Monday)

import { createClient } from '@supabase/supabase-js';
import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';

export const config = {
  maxDuration: 300 // 5 minutes max for cron jobs on Vercel
};

// Initialize Supabase client
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch stargazers using GraphQL
async function fetchStargazersGraphQL(token, owner, repo, sinceDate = null) {
  const graphqlWithAuth = graphql.defaults({
    headers: { authorization: `token ${token}` }
  });

  const stargazers = [];
  let cursor = null;
  let hasNextPage = true;

  const query = `
    query($owner: String!, $repo: String!, $first: Int!, $after: String) {
      repository(owner: $owner, name: $repo) {
        stargazers(first: $first, after: $after, orderBy: {field: STARRED_AT, direction: ASC}) {
          edges {
            starredAt
            node { login }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
        rateLimit { remaining resetAt }
      }
    }
  `;

  while (hasNextPage) {
    try {
      const result = await graphqlWithAuth(query, {
        owner, repo, first: 100, after: cursor
      });

      const { edges, pageInfo } = result.repository.stargazers;

      for (const edge of edges) {
        // If we have a sinceDate, only include stars after that date
        if (sinceDate && edge.starredAt < sinceDate) continue;
        stargazers.push({ starredAt: edge.starredAt });
      }

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;

      // Check rate limit
      if (result.repository.rateLimit.remaining < 50) {
        const resetTime = new Date(result.repository.rateLimit.resetAt).getTime();
        const waitTime = Math.max(0, resetTime - Date.now()) + 5000;
        console.log(`Rate limit low, waiting ${Math.ceil(waitTime / 1000)}s...`);
        await sleep(waitTime);
      }
    } catch (error) {
      if (error.message?.includes('rate limit')) {
        console.log('Hit rate limit, stopping stars fetch');
        break;
      }
      throw error;
    }
  }

  return stargazers;
}

// Fetch issues since date
async function fetchIssuesSince(octokit, owner, repo, sinceDate) {
  const issues = [];
  let page = 1;

  while (true) {
    try {
      const { data } = await octokit.issues.listForRepo({
        owner, repo,
        state: 'all',
        since: sinceDate,
        per_page: 100,
        page
      });

      if (data.length === 0) break;

      for (const issue of data) {
        if (!issue.pull_request) {
          issues.push({
            createdAt: issue.created_at,
            closedAt: issue.closed_at
          });
        }
      }

      if (data.length < 100) break;
      page++;
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        console.log('Rate limited on issues, stopping');
        break;
      }
      throw error;
    }
  }

  return issues;
}

// Fetch commits since date
async function fetchCommitsSince(octokit, owner, repo, sinceDate) {
  const commits = [];
  let page = 1;

  while (true) {
    try {
      const { data } = await octokit.repos.listCommits({
        owner, repo,
        since: sinceDate,
        per_page: 100,
        page
      });

      if (data.length === 0) break;

      for (const commit of data) {
        commits.push({
          date: commit.commit.author?.date || commit.commit.committer?.date,
          author: commit.author?.login || commit.commit.author?.name
        });
      }

      if (data.length < 100) break;
      page++;
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        console.log('Rate limited on commits, stopping');
        break;
      }
      throw error;
    }
  }

  return commits;
}

// Get cached repos
async function getCachedRepos(supabase) {
  const { data, error } = await supabase
    .from('repositories')
    .select('*')
    .order('last_fetched', { ascending: true }); // Oldest first

  if (error) {
    console.error('Error fetching repos:', error);
    return [];
  }
  return data || [];
}

// Update repo's last_fetched timestamp
async function updateRepoTimestamp(supabase, owner, repo) {
  await supabase
    .from('repositories')
    .update({ last_fetched: new Date().toISOString() })
    .eq('owner', owner)
    .eq('repo', repo);
}

// Log cron run
async function logCronRun(supabase, results) {
  try {
    await supabase
      .from('cron_logs')
      .insert({
        job_name: 'refresh-repos',
        run_at: new Date().toISOString(),
        trending_count: results.totalRepos,
        new_repos_count: results.refreshedCount,
        fetched_count: results.refreshedCount,
        errors: results.errors
      });
  } catch (e) {
    console.log('Could not log cron run:', e.message);
  }
}

export default async function handler(req, res) {
  // Verify cron request
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('Unauthorized cron request');
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return res.status(500).json({ error: 'GitHub token not configured' });
  }

  const results = {
    totalRepos: 0,
    refreshedCount: 0,
    skippedCount: 0,
    errors: []
  };

  const octokit = new Octokit({ auth: githubToken });

  try {
    const repos = await getCachedRepos(supabase);
    results.totalRepos = repos.length;
    console.log(`Found ${repos.length} cached repos to refresh`);

    const today = new Date().toISOString().split('T')[0];

    for (const repo of repos) {
      const repoName = `${repo.owner}/${repo.repo}`;

      try {
        // Get the last date we have data for
        const { data: lastMetric } = await supabase
          .from('daily_metrics')
          .select('date')
          .eq('repo_id', repo.id)
          .order('date', { ascending: false })
          .limit(1)
          .single();

        const lastDate = lastMetric?.date;

        // Skip if already up to date
        if (lastDate === today) {
          console.log(`Skipping ${repoName} - already up to date`);
          results.skippedCount++;
          continue;
        }

        console.log(`Refreshing ${repoName} (last data: ${lastDate || 'none'})...`);

        // Fetch new data since last date
        const sinceDate = lastDate ? new Date(lastDate).toISOString() : null;

        const [newStars, newIssues, newCommits] = await Promise.all([
          sinceDate ? fetchStargazersGraphQL(githubToken, repo.owner, repo.repo, sinceDate) : [],
          sinceDate ? fetchIssuesSince(octokit, repo.owner, repo.repo, sinceDate) : [],
          sinceDate ? fetchCommitsSince(octokit, repo.owner, repo.repo, sinceDate) : []
        ]);

        console.log(`  Found ${newStars.length} new stars, ${newIssues.length} new issues, ${newCommits.length} new commits`);

        // Update timestamp
        await updateRepoTimestamp(supabase, repo.owner, repo.repo);
        results.refreshedCount++;

      } catch (err) {
        console.error(`Error refreshing ${repoName}:`, err.message);
        results.errors.push({ repo: repoName, error: err.message });

        // If rate limited, stop processing
        if (err.status === 403 || err.status === 429 || err.message?.includes('rate limit')) {
          console.log('Rate limited, stopping refresh');
          break;
        }
      }
    }

    await logCronRun(supabase, results);

    return res.status(200).json({
      success: true,
      message: `Refreshed ${results.refreshedCount} repos, skipped ${results.skippedCount}`,
      ...results
    });

  } catch (error) {
    console.error('Cron job failed:', error);
    results.errors.push({ error: error.message });
    await logCronRun(supabase, results);
    return res.status(500).json({ error: error.message, ...results });
  }
}
