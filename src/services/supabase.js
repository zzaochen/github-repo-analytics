import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

console.log('Supabase client initialized:', !!supabase, 'URL:', supabaseUrl ? 'set' : 'missing');

export async function getRepoFromCache(owner, repo) {
  console.log('getRepoFromCache called for:', owner, repo, 'supabase:', !!supabase);
  if (!supabase) return null;

  try {
    const { data: repoData, error: repoError } = await supabase
      .from('repositories')
      .select('*')
      .eq('owner', owner)
      .eq('repo', repo)
      .single();

    console.log('Repository query result:', repoData, 'error:', repoError);
    if (repoError || !repoData) return null;

    // Fetch all metrics - Supabase has a default limit of 1000, so we need to paginate
    let allMetrics = [];
    let from = 0;
    const batchSize = 1000;

    while (true) {
      const { data: batch, error: batchError } = await supabase
        .from('daily_metrics')
        .select('*')
        .eq('repo_id', repoData.id)
        .order('date', { ascending: true })
        .range(from, from + batchSize - 1);

      if (batchError) {
        console.error('Error fetching metrics batch:', batchError);
        return null;
      }

      if (!batch || batch.length === 0) break;

      allMetrics = allMetrics.concat(batch);
      console.log(`Fetched metrics batch: ${batch.length} rows (total: ${allMetrics.length})`);

      if (batch.length < batchSize) break; // Last batch
      from += batchSize;
    }

    const metrics = allMetrics;
    console.log('Metrics query result: count=', metrics?.length);
    if (!metrics) return null;

    // Find the last date we have data for
    const lastDate = metrics.length > 0 ? metrics[metrics.length - 1].date : null;

    console.log('Returning cache with', metrics?.length, 'metrics, lastDate:', lastDate);
    return {
      repository: repoData,
      metrics: metrics || [],
      lastDate,
      // Fetch state for each metric type
      fetchState: {
        stars: {
          lastPage: repoData.stars_last_page,
          limited: repoData.stars_pagination_limited,
          cursor: repoData.stars_cursor // GraphQL cursor for resuming
        },
        forks: {
          lastPage: repoData.forks_last_page,
          limited: repoData.forks_pagination_limited
        },
        prs: {
          lastPage: repoData.prs_last_page,
          limited: repoData.prs_pagination_limited
        },
        issues: {
          lastDate: repoData.issues_last_date
        },
        commits: {
          lastDate: repoData.commits_last_date
        }
      }
    };
  } catch (error) {
    console.error('Error fetching from cache:', error);
    return null;
  }
}

export async function saveRepoToCache(owner, repo, dailyMetrics, incrementalUpdate = false, fetchState = null) {
  if (!supabase) return null;

  try {
    // Upsert repository with optional fetch state for all metrics
    const repoRecord = {
      owner,
      repo,
      last_fetched: new Date().toISOString()
    };

    // Add fetch state if provided (tracks pagination/date progress for each metric)
    if (fetchState) {
      if (fetchState.stars) {
        repoRecord.stars_last_page = fetchState.stars.lastPage;
        repoRecord.stars_pagination_limited = fetchState.stars.limited;
        repoRecord.stars_cursor = fetchState.stars.cursor; // GraphQL cursor for resuming
      }
      if (fetchState.forks) {
        repoRecord.forks_last_page = fetchState.forks.lastPage;
        repoRecord.forks_pagination_limited = fetchState.forks.limited;
      }
      if (fetchState.prs) {
        repoRecord.prs_last_page = fetchState.prs.lastPage;
        repoRecord.prs_pagination_limited = fetchState.prs.limited;
      }
      // Issues and commits use date-based 'since' parameter, track last date
      if (fetchState.issues) {
        repoRecord.issues_last_date = fetchState.issues.lastDate;
      }
      if (fetchState.commits) {
        repoRecord.commits_last_date = fetchState.commits.lastDate;
      }
    }

    const { data: repoData, error: repoError } = await supabase
      .from('repositories')
      .upsert(repoRecord, { onConflict: 'owner,repo' })
      .select()
      .single();

    if (repoError) {
      console.error('Error saving repository:', repoError);
      return null;
    }

    if (!incrementalUpdate) {
      // Full refresh - delete existing metrics
      await supabase
        .from('daily_metrics')
        .delete()
        .eq('repo_id', repoData.id);
    }

    // Insert/upsert metrics in batches
    const batchSize = 100;
    for (let i = 0; i < dailyMetrics.length; i += batchSize) {
      const batch = dailyMetrics.slice(i, i + batchSize).map(m => ({
        repo_id: repoData.id,
        date: m.date,
        total_stars: m.totalStars,
        total_forks: m.totalForks,
        total_contributors: m.totalContributors,
        total_issues_opened: m.totalIssuesOpened,
        total_issues_closed: m.totalIssuesClosed,
        total_prs_opened: m.totalPRsOpened,
        total_prs_closed: m.totalPRsClosed,
        total_prs_merged: m.totalPRsMerged
      }));

      if (incrementalUpdate) {
        // Upsert for incremental updates
        const { error } = await supabase
          .from('daily_metrics')
          .upsert(batch, { onConflict: 'repo_id,date' });

        if (error) {
          console.error('Error upserting metrics batch:', error);
        }
      } else {
        const { error } = await supabase
          .from('daily_metrics')
          .insert(batch);

        if (error) {
          console.error('Error saving metrics batch:', error);
        }
      }
    }

    return repoData;
  } catch (error) {
    console.error('Error saving to cache:', error);
    return null;
  }
}

export function transformCachedMetrics(metrics) {
  return metrics.map(m => ({
    date: m.date,
    totalStars: m.total_stars,
    totalForks: m.total_forks,
    totalContributors: m.total_contributors,
    totalIssuesOpened: m.total_issues_opened,
    totalIssuesClosed: m.total_issues_closed,
    totalPRsOpened: m.total_prs_opened,
    totalPRsClosed: m.total_prs_closed,
    totalPRsMerged: m.total_prs_merged
  }));
}

export async function getCachedRepos() {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('repositories')
      .select('*')
      .order('last_fetched', { ascending: false });

    if (error) {
      console.error('Error fetching cached repos:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching cached repos:', error);
    return [];
  }
}

// Delete a repository and its metrics from cache
export async function deleteRepoFromCache(owner, repo) {
  if (!supabase) return false;

  try {
    // First get the repo ID
    const { data: repoData } = await supabase
      .from('repositories')
      .select('id')
      .eq('owner', owner)
      .eq('repo', repo)
      .single();

    if (repoData) {
      // Delete metrics first (foreign key constraint)
      await supabase
        .from('daily_metrics')
        .delete()
        .eq('repo_id', repoData.id);

      // Delete repository
      await supabase
        .from('repositories')
        .delete()
        .eq('id', repoData.id);
    }

    console.log(`Deleted ${owner}/${repo} from cache`);
    return true;
  } catch (error) {
    console.error('Error deleting from cache:', error);
    return false;
  }
}

// Merge new daily metrics with existing cached metrics
// For pagination resumption, we need to ADD new values to existing ones
export function mergeDailyMetrics(existingMetrics, newMetrics) {
  const metricsByDate = new Map();

  // Add existing metrics
  for (const m of existingMetrics) {
    metricsByDate.set(m.date, { ...m });
  }

  // For new metrics, we need to ADD values (not overwrite) because
  // when resuming pagination, we're getting additional data for the same time period
  for (const m of newMetrics) {
    if (metricsByDate.has(m.date)) {
      const existing = metricsByDate.get(m.date);
      // Add new values to existing values
      metricsByDate.set(m.date, {
        date: m.date,
        totalStars: existing.totalStars + m.totalStars,
        totalForks: existing.totalForks + m.totalForks,
        totalContributors: Math.max(existing.totalContributors, m.totalContributors), // Contributors: take max
        totalIssuesOpened: Math.max(existing.totalIssuesOpened, m.totalIssuesOpened),
        totalIssuesClosed: Math.max(existing.totalIssuesClosed, m.totalIssuesClosed),
        totalPRsOpened: Math.max(existing.totalPRsOpened, m.totalPRsOpened),
        totalPRsClosed: Math.max(existing.totalPRsClosed, m.totalPRsClosed),
        totalPRsMerged: Math.max(existing.totalPRsMerged, m.totalPRsMerged)
      });
    } else {
      metricsByDate.set(m.date, { ...m });
    }
  }

  // Sort by date and recalculate cumulative totals to ensure consistency
  const sorted = Array.from(metricsByDate.values())
    .sort((a, b) => a.date.localeCompare(b.date));

  // For cumulative metrics that were added, we need to recalculate
  // to ensure the running totals are correct
  let runningStars = 0;
  let runningForks = 0;

  // First pass: convert to daily increments
  const withIncrements = sorted.map((day, i) => {
    const prevDay = i > 0 ? sorted[i - 1] : null;
    return {
      ...day,
      starsIncrement: prevDay ? Math.max(0, day.totalStars - prevDay.totalStars) : day.totalStars,
      forksIncrement: prevDay ? Math.max(0, day.totalForks - prevDay.totalForks) : day.totalForks
    };
  });

  // Second pass: recalculate cumulative totals
  return withIncrements.map(day => {
    runningStars += day.starsIncrement;
    runningForks += day.forksIncrement;
    return {
      date: day.date,
      totalStars: runningStars,
      totalForks: runningForks,
      totalContributors: day.totalContributors,
      totalIssuesOpened: day.totalIssuesOpened,
      totalIssuesClosed: day.totalIssuesClosed,
      totalPRsOpened: day.totalPRsOpened,
      totalPRsClosed: day.totalPRsClosed,
      totalPRsMerged: day.totalPRsMerged
    };
  });
}
