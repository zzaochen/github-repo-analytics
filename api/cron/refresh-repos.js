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

// Fetch NEW stargazers using GraphQL (DESC order - newest first, stop when hitting old data)
// This is O(new stars) instead of O(total stars)
async function fetchNewStargazersGraphQL(token, owner, repo, sinceDate) {
  if (!sinceDate) return [];

  const graphqlWithAuth = graphql.defaults({
    headers: { authorization: `token ${token}` }
  });

  const stargazers = [];
  let cursor = null;
  let hasNextPage = true;

  // Use DESC order (newest first) so we can stop early when hitting old stars
  const query = `
    query($owner: String!, $repo: String!, $first: Int!, $after: String) {
      repository(owner: $owner, name: $repo) {
        stargazers(first: $first, after: $after, orderBy: {field: STARRED_AT, direction: DESC}) {
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
      let foundOldStar = false;

      for (const edge of edges) {
        // Since we're going newest first, stop when we hit a star older than sinceDate
        if (edge.starredAt <= sinceDate) {
          foundOldStar = true;
          break;
        }
        stargazers.push({ starredAt: edge.starredAt });
      }

      // Stop if we found an old star (all remaining are older)
      if (foundOldStar) {
        break;
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

// Fetch forks since date (sorted by newest first for efficiency)
async function fetchForksSince(octokit, owner, repo, sinceDate) {
  if (!sinceDate) return [];

  const forks = [];
  let page = 1;
  const sinceDateObj = new Date(sinceDate);

  while (true) {
    try {
      const { data } = await octokit.repos.listForks({
        owner, repo,
        sort: 'newest',
        per_page: 100,
        page
      });

      if (data.length === 0) break;

      let foundOldFork = false;
      for (const fork of data) {
        const forkDate = new Date(fork.created_at);
        if (forkDate <= sinceDateObj) {
          foundOldFork = true;
          break;
        }
        forks.push({ forkedAt: fork.created_at });
      }

      // Stop if we found an old fork
      if (foundOldFork) break;
      if (data.length < 100) break;
      page++;
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        console.log('Rate limited on forks, stopping');
        break;
      }
      throw error;
    }
  }

  return forks;
}

// Fetch issues since date
async function fetchIssuesSince(octokit, owner, repo, sinceDate) {
  if (!sinceDate) return [];

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

// Fetch PRs since date (sorted by created, newest first)
async function fetchPRsSince(octokit, owner, repo, sinceDate) {
  if (!sinceDate) return [];

  const prs = [];
  let page = 1;
  const sinceDateObj = new Date(sinceDate);

  while (true) {
    try {
      const { data } = await octokit.pulls.list({
        owner, repo,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: 100,
        page
      });

      if (data.length === 0) break;

      let foundOldPR = false;
      for (const pr of data) {
        const prDate = new Date(pr.created_at);
        if (prDate <= sinceDateObj) {
          foundOldPR = true;
          break;
        }
        prs.push({
          createdAt: pr.created_at,
          closedAt: pr.closed_at,
          mergedAt: pr.merged_at
        });
      }

      if (foundOldPR) break;
      if (data.length < 100) break;
      page++;
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        console.log('Rate limited on PRs, stopping');
        break;
      }
      throw error;
    }
  }

  return prs;
}

// Fetch commits since date
async function fetchCommitsSince(octokit, owner, repo, sinceDate) {
  if (!sinceDate) return [];

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

// Aggregate new data into daily metrics
function aggregateNewDataToDaily(newStars, newForks, newIssues, newPRs, newCommits, startDate) {
  const dailyMap = new Map();

  // Helper to get or create day entry
  const getDay = (dateStr) => {
    const date = dateStr.split('T')[0];
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        newStars: 0,
        newForks: 0,
        issuesOpened: 0,
        issuesClosed: 0,
        prsOpened: 0,
        prsClosed: 0,
        prsMerged: 0,
        commits: 0
      });
    }
    return dailyMap.get(date);
  };

  // Aggregate stars
  for (const star of newStars) {
    const day = getDay(star.starredAt);
    day.newStars++;
  }

  // Aggregate forks
  for (const fork of newForks) {
    const day = getDay(fork.forkedAt);
    day.newForks++;
  }

  // Aggregate issues
  for (const issue of newIssues) {
    if (issue.createdAt && issue.createdAt > startDate) {
      const day = getDay(issue.createdAt);
      day.issuesOpened++;
    }
    if (issue.closedAt && issue.closedAt > startDate) {
      const day = getDay(issue.closedAt);
      day.issuesClosed++;
    }
  }

  // Aggregate PRs
  for (const pr of newPRs) {
    if (pr.createdAt) {
      const day = getDay(pr.createdAt);
      day.prsOpened++;
    }
    if (pr.closedAt) {
      const day = getDay(pr.closedAt);
      day.prsClosed++;
    }
    if (pr.mergedAt) {
      const day = getDay(pr.mergedAt);
      day.prsMerged++;
    }
  }

  // Aggregate commits
  for (const commit of newCommits) {
    if (commit.date) {
      const day = getDay(commit.date);
      day.commits++;
    }
  }

  return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
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

// Get last metric for repo to get cumulative totals
async function getLastMetric(supabase, repoId) {
  const { data } = await supabase
    .from('daily_metrics')
    .select('*')
    .eq('repo_id', repoId)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  return data;
}

// Save new daily metrics incrementally
async function saveNewDailyMetrics(supabase, repoId, newDailyData, lastMetric) {
  if (newDailyData.length === 0) return;

  // Start with last known totals
  let runningTotals = {
    stars: lastMetric?.total_stars || 0,
    forks: lastMetric?.total_forks || 0,
    issuesOpened: lastMetric?.total_issues_opened || 0,
    issuesClosed: lastMetric?.total_issues_closed || 0,
    prsOpened: lastMetric?.total_prs_opened || 0,
    prsClosed: lastMetric?.total_prs_closed || 0,
    prsMerged: lastMetric?.total_prs_merged || 0
  };

  const metricsToInsert = [];

  for (const day of newDailyData) {
    // Update running totals
    runningTotals.stars += day.newStars;
    runningTotals.forks += day.newForks;
    runningTotals.issuesOpened += day.issuesOpened;
    runningTotals.issuesClosed += day.issuesClosed;
    runningTotals.prsOpened += day.prsOpened;
    runningTotals.prsClosed += day.prsClosed;
    runningTotals.prsMerged += day.prsMerged;

    metricsToInsert.push({
      repo_id: repoId,
      date: day.date,
      total_stars: runningTotals.stars,
      total_forks: runningTotals.forks,
      total_issues_opened: runningTotals.issuesOpened,
      total_issues_closed: runningTotals.issuesClosed,
      total_prs_opened: runningTotals.prsOpened,
      total_prs_closed: runningTotals.prsClosed,
      total_prs_merged: runningTotals.prsMerged,
      commits: day.commits
    });
  }

  // Upsert to handle any overlapping dates
  const { error } = await supabase
    .from('daily_metrics')
    .upsert(metricsToInsert, { onConflict: 'repo_id,date' });

  if (error) {
    console.error('Error saving metrics:', error);
    throw error;
  }
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
    return res.status(401).json({ error: 'Unauthorized' });
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
        // Get the last metric to know where to resume from
        const lastMetric = await getLastMetric(supabase, repo.id);
        const lastDate = lastMetric?.date;

        // Skip if already up to date
        if (lastDate === today) {
          console.log(`Skipping ${repoName} - already up to date`);
          results.skippedCount++;
          continue;
        }

        // Go back 1 day to ensure we don't miss any data from partial syncs or timezone issues
        // The upsert will handle any duplicates
        const overlapDays = 1;
        let sinceDate = null;
        let baseMetric = lastMetric;

        if (lastDate) {
          const lastDateObj = new Date(lastDate);
          lastDateObj.setDate(lastDateObj.getDate() - overlapDays);
          const overlapDate = lastDateObj.toISOString().split('T')[0];
          sinceDate = `${overlapDate}T00:00:00Z`;

          // Get the metric from before the overlap period to use as base for running totals
          const { data: overlapBaseMetric } = await supabase
            .from('daily_metrics')
            .select('*')
            .eq('repo_id', repo.id)
            .lt('date', overlapDate)
            .order('date', { ascending: false })
            .limit(1)
            .single();

          if (overlapBaseMetric) {
            baseMetric = overlapBaseMetric;
          }
        }

        console.log(`Refreshing ${repoName} (last data: ${lastDate || 'none'}, fetching since: ${sinceDate || 'beginning'})...`);

        const [newStars, newForks, newIssues, newPRs, newCommits] = await Promise.all([
          fetchNewStargazersGraphQL(githubToken, repo.owner, repo.repo, sinceDate),
          fetchForksSince(octokit, repo.owner, repo.repo, sinceDate),
          fetchIssuesSince(octokit, repo.owner, repo.repo, sinceDate),
          fetchPRsSince(octokit, repo.owner, repo.repo, sinceDate),
          fetchCommitsSince(octokit, repo.owner, repo.repo, sinceDate)
        ]);

        console.log(`  Found ${newStars.length} new stars, ${newForks.length} new forks, ${newIssues.length} issues, ${newPRs.length} PRs, ${newCommits.length} commits`);

        // Aggregate into daily metrics
        const newDailyData = aggregateNewDataToDaily(
          newStars, newForks, newIssues, newPRs, newCommits, sinceDate
        );

        // Save to database (uses baseMetric from before overlap for correct running totals)
        if (newDailyData.length > 0) {
          await saveNewDailyMetrics(supabase, repo.id, newDailyData, baseMetric);
          console.log(`  Saved ${newDailyData.length} new daily records`);
        }

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
