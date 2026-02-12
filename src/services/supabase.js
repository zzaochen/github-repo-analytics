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

    // Calculate and save monthly metrics
    const monthlyMetrics = calculateMonthlyMetrics(dailyMetrics);
    await saveMonthlyMetrics(repoData.id, monthlyMetrics);

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

// Calculate monthly metrics from daily metrics
export function calculateMonthlyMetrics(dailyMetrics) {
  if (!dailyMetrics || dailyMetrics.length === 0) return [];

  // Group daily metrics by month (using month-end date)
  const monthlyData = new Map();

  for (const day of dailyMetrics) {
    const date = new Date(day.date);
    // Get the last day of the month
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const monthEndStr = monthEnd.toISOString().split('T')[0];

    // Keep the latest day's data for each month (which represents month-end values)
    if (!monthlyData.has(monthEndStr) || day.date > monthlyData.get(monthEndStr).date) {
      monthlyData.set(monthEndStr, {
        monthEnd: monthEndStr,
        date: day.date,
        stars: day.totalStars || 0,
        forks: day.totalForks || 0,
        issuesOpened: day.totalIssuesOpened || 0,
        issuesClosed: day.totalIssuesClosed || 0,
        prsOpened: day.totalPRsOpened || 0,
        prsMerged: day.totalPRsMerged || 0,
        contributors: day.totalContributors || 0
      });
    }
  }

  // Sort by month and calculate MoM changes
  const sortedMonths = Array.from(monthlyData.values())
    .sort((a, b) => a.monthEnd.localeCompare(b.monthEnd));

  return sortedMonths.map((month, index) => {
    const prevMonth = index > 0 ? sortedMonths[index - 1] : null;

    const calcChange = (current, previous) => previous !== null ? current - previous : null;
    const calcGrowthPct = (current, previous) => {
      if (previous === null || previous === 0) return null;
      return Math.round(((current - previous) / previous) * 10000) / 100; // 2 decimal places
    };

    return {
      monthEnd: month.monthEnd,

      starsAtMonthEnd: month.stars,
      starsMomChange: calcChange(month.stars, prevMonth?.stars ?? null),
      starsMomGrowthPct: calcGrowthPct(month.stars, prevMonth?.stars ?? null),

      forksAtMonthEnd: month.forks,
      forksMomChange: calcChange(month.forks, prevMonth?.forks ?? null),
      forksMomGrowthPct: calcGrowthPct(month.forks, prevMonth?.forks ?? null),

      issuesOpenedAtMonthEnd: month.issuesOpened,
      issuesOpenedMomChange: calcChange(month.issuesOpened, prevMonth?.issuesOpened ?? null),
      issuesOpenedMomGrowthPct: calcGrowthPct(month.issuesOpened, prevMonth?.issuesOpened ?? null),

      issuesClosedAtMonthEnd: month.issuesClosed,
      issuesClosedMomChange: calcChange(month.issuesClosed, prevMonth?.issuesClosed ?? null),
      issuesClosedMomGrowthPct: calcGrowthPct(month.issuesClosed, prevMonth?.issuesClosed ?? null),

      prsOpenedAtMonthEnd: month.prsOpened,
      prsOpenedMomChange: calcChange(month.prsOpened, prevMonth?.prsOpened ?? null),
      prsOpenedMomGrowthPct: calcGrowthPct(month.prsOpened, prevMonth?.prsOpened ?? null),

      prsMergedAtMonthEnd: month.prsMerged,
      prsMergedMomChange: calcChange(month.prsMerged, prevMonth?.prsMerged ?? null),
      prsMergedMomGrowthPct: calcGrowthPct(month.prsMerged, prevMonth?.prsMerged ?? null),

      contributorsAtMonthEnd: month.contributors,
      contributorsMomChange: calcChange(month.contributors, prevMonth?.contributors ?? null),
      contributorsMomGrowthPct: calcGrowthPct(month.contributors, prevMonth?.contributors ?? null)
    };
  });
}

// Save monthly metrics to Supabase
export async function saveMonthlyMetrics(repoId, monthlyMetrics) {
  if (!supabase || !monthlyMetrics || monthlyMetrics.length === 0) return;

  try {
    // Delete existing monthly metrics for this repo
    await supabase
      .from('monthly_metrics')
      .delete()
      .eq('repo_id', repoId);

    // Insert new monthly metrics in batches
    const batchSize = 100;
    for (let i = 0; i < monthlyMetrics.length; i += batchSize) {
      const batch = monthlyMetrics.slice(i, i + batchSize).map(m => ({
        repo_id: repoId,
        month_end: m.monthEnd,
        stars_at_month_end: m.starsAtMonthEnd,
        stars_mom_change: m.starsMomChange,
        stars_mom_growth_pct: m.starsMomGrowthPct,
        forks_at_month_end: m.forksAtMonthEnd,
        forks_mom_change: m.forksMomChange,
        forks_mom_growth_pct: m.forksMomGrowthPct,
        issues_opened_at_month_end: m.issuesOpenedAtMonthEnd,
        issues_opened_mom_change: m.issuesOpenedMomChange,
        issues_opened_mom_growth_pct: m.issuesOpenedMomGrowthPct,
        issues_closed_at_month_end: m.issuesClosedAtMonthEnd,
        issues_closed_mom_change: m.issuesClosedMomChange,
        issues_closed_mom_growth_pct: m.issuesClosedMomGrowthPct,
        prs_opened_at_month_end: m.prsOpenedAtMonthEnd,
        prs_opened_mom_change: m.prsOpenedMomChange,
        prs_opened_mom_growth_pct: m.prsOpenedMomGrowthPct,
        prs_merged_at_month_end: m.prsMergedAtMonthEnd,
        prs_merged_mom_change: m.prsMergedMomChange,
        prs_merged_mom_growth_pct: m.prsMergedMomGrowthPct,
        contributors_at_month_end: m.contributorsAtMonthEnd,
        contributors_mom_change: m.contributorsMomChange,
        contributors_mom_growth_pct: m.contributorsMomGrowthPct,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('monthly_metrics')
        .insert(batch);

      if (error) {
        console.error('Error saving monthly metrics batch:', error);
      }
    }

    console.log(`Saved ${monthlyMetrics.length} monthly metrics for repo ${repoId}`);
  } catch (error) {
    console.error('Error saving monthly metrics:', error);
  }
}

// Fetch monthly metrics for a repository
export async function getMonthlyMetrics(owner, repo) {
  if (!supabase) return [];

  try {
    // First get the repo ID
    const { data: repoData, error: repoError } = await supabase
      .from('repositories')
      .select('id')
      .eq('owner', owner)
      .eq('repo', repo)
      .single();

    if (repoError || !repoData) return [];

    const { data, error } = await supabase
      .from('monthly_metrics')
      .select('*')
      .eq('repo_id', repoData.id)
      .order('month_end', { ascending: true });

    if (error) {
      console.error('Error fetching monthly metrics:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching monthly metrics:', error);
    return [];
  }
}

// Transform monthly metrics from DB format to frontend format
export function transformMonthlyMetrics(metrics) {
  return metrics.map(m => ({
    monthEnd: m.month_end,
    starsAtMonthEnd: m.stars_at_month_end,
    starsMomChange: m.stars_mom_change,
    starsMomGrowthPct: m.stars_mom_growth_pct,
    forksAtMonthEnd: m.forks_at_month_end,
    forksMomChange: m.forks_mom_change,
    forksMomGrowthPct: m.forks_mom_growth_pct,
    issuesOpenedAtMonthEnd: m.issues_opened_at_month_end,
    issuesOpenedMomChange: m.issues_opened_mom_change,
    issuesOpenedMomGrowthPct: m.issues_opened_mom_growth_pct,
    issuesClosedAtMonthEnd: m.issues_closed_at_month_end,
    issuesClosedMomChange: m.issues_closed_mom_change,
    issuesClosedMomGrowthPct: m.issues_closed_mom_growth_pct,
    prsOpenedAtMonthEnd: m.prs_opened_at_month_end,
    prsOpenedMomChange: m.prs_opened_mom_change,
    prsOpenedMomGrowthPct: m.prs_opened_mom_growth_pct,
    prsMergedAtMonthEnd: m.prs_merged_at_month_end,
    prsMergedMomChange: m.prs_merged_mom_change,
    prsMergedMomGrowthPct: m.prs_merged_mom_growth_pct,
    contributorsAtMonthEnd: m.contributors_at_month_end,
    contributorsMomChange: m.contributors_mom_change,
    contributorsMomGrowthPct: m.contributors_mom_growth_pct
  }));
}

// Backfill monthly metrics for all cached repos from existing daily data
export async function backfillAllMonthlyMetrics() {
  if (!supabase) return { success: false, message: 'Supabase not configured' };

  try {
    // Get all repositories
    const { data: repos, error: reposError } = await supabase
      .from('repositories')
      .select('id, owner, repo');

    if (reposError) {
      console.error('Error fetching repos:', reposError);
      return { success: false, message: reposError.message };
    }

    let processed = 0;
    for (const repo of repos) {
      // Fetch daily metrics for this repo
      let allMetrics = [];
      let from = 0;
      const batchSize = 1000;

      while (true) {
        const { data: batch, error: batchError } = await supabase
          .from('daily_metrics')
          .select('*')
          .eq('repo_id', repo.id)
          .order('date', { ascending: true })
          .range(from, from + batchSize - 1);

        if (batchError || !batch || batch.length === 0) break;
        allMetrics = allMetrics.concat(batch);
        if (batch.length < batchSize) break;
        from += batchSize;
      }

      if (allMetrics.length > 0) {
        // Transform to frontend format
        const transformed = transformCachedMetrics(allMetrics);
        // Calculate monthly metrics
        const monthlyMetrics = calculateMonthlyMetrics(transformed);
        // Save to database
        await saveMonthlyMetrics(repo.id, monthlyMetrics);
        processed++;
        console.log(`Backfilled monthly metrics for ${repo.owner}/${repo.repo}`);
      }
    }

    return { success: true, message: `Backfilled ${processed} repositories` };
  } catch (error) {
    console.error('Error backfilling monthly metrics:', error);
    return { success: false, message: error.message };
  }
}

// Get monthly metrics for multiple repos (for comparison)
export async function getMonthlyMetricsForRepos(repoKeys) {
  if (!supabase || !repoKeys || repoKeys.length === 0) return {};

  try {
    const result = {};

    for (const repoKey of repoKeys) {
      const [owner, repo] = repoKey.split('/');

      // Get repo ID
      const { data: repoData, error: repoError } = await supabase
        .from('repositories')
        .select('id')
        .eq('owner', owner)
        .eq('repo', repo)
        .single();

      if (repoError || !repoData) continue;

      // Get monthly metrics
      const { data, error } = await supabase
        .from('monthly_metrics')
        .select('*')
        .eq('repo_id', repoData.id)
        .order('month_end', { ascending: true });

      if (!error && data) {
        result[repoKey] = transformMonthlyMetrics(data);
      }
    }

    return result;
  } catch (error) {
    console.error('Error fetching monthly metrics for repos:', error);
    return {};
  }
}

// Get or create a repository record (for incremental saving)
export async function getOrCreateRepo(owner, repo) {
  if (!supabase) return null;

  try {
    // Try to get existing repo
    let { data: repoData, error } = await supabase
      .from('repositories')
      .select('*')
      .eq('owner', owner)
      .eq('repo', repo)
      .single();

    if (error && error.code === 'PGRST116') {
      // Not found, create it
      const { data: newRepo, error: insertError } = await supabase
        .from('repositories')
        .insert({ owner, repo, last_fetched: new Date().toISOString() })
        .select()
        .single();

      if (insertError) {
        console.error('Error creating repository:', insertError);
        return null;
      }
      return newRepo;
    }

    if (error) {
      console.error('Error fetching repository:', error);
      return null;
    }

    return repoData;
  } catch (error) {
    console.error('Error in getOrCreateRepo:', error);
    return null;
  }
}

// Update fetch progress/state for a repository (cursor, page, etc.)
export async function updateFetchProgress(owner, repo, fetchState) {
  if (!supabase) return false;

  try {
    const updateData = {
      last_fetched: new Date().toISOString()
    };

    // Add fetch state fields
    if (fetchState.stars) {
      updateData.stars_last_page = fetchState.stars.lastPage;
      updateData.stars_pagination_limited = fetchState.stars.limited;
      updateData.stars_cursor = fetchState.stars.cursor;
    }
    if (fetchState.forks) {
      updateData.forks_last_page = fetchState.forks.lastPage;
      updateData.forks_pagination_limited = fetchState.forks.limited;
    }
    if (fetchState.prs) {
      updateData.prs_last_page = fetchState.prs.lastPage;
      updateData.prs_pagination_limited = fetchState.prs.limited;
    }
    if (fetchState.issues) {
      updateData.issues_last_date = fetchState.issues.lastDate;
    }
    if (fetchState.commits) {
      updateData.commits_last_date = fetchState.commits.lastDate;
    }
    // Track if fetch is in progress (for resume detection)
    if (fetchState.inProgress !== undefined) {
      updateData.fetch_in_progress = fetchState.inProgress;
    }

    const { error } = await supabase
      .from('repositories')
      .update(updateData)
      .eq('owner', owner)
      .eq('repo', repo);

    if (error) {
      console.error('Error updating fetch progress:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in updateFetchProgress:', error);
    return false;
  }
}

// Save raw fetch data incrementally (stars, forks, etc.) to a staging table
// This allows resuming from exactly where we left off
export async function saveIncrementalRawData(owner, repo, dataType, items) {
  if (!supabase || !items || items.length === 0) return true;

  try {
    const repoData = await getOrCreateRepo(owner, repo);
    if (!repoData) return false;

    // Save to a raw data staging table based on type
    const tableName = `raw_${dataType}`;

    // For now, we'll store the processed daily metrics incrementally
    // The raw data approach would need additional tables
    console.log(`Would save ${items.length} ${dataType} items for ${owner}/${repo}`);
    return true;
  } catch (error) {
    console.error(`Error saving incremental ${dataType}:`, error);
    return false;
  }
}

// Save partial daily metrics during fetch (upsert to not lose existing data)
export async function savePartialMetrics(owner, repo, dailyMetrics) {
  if (!supabase || !dailyMetrics || dailyMetrics.length === 0) return true;

  try {
    const repoData = await getOrCreateRepo(owner, repo);
    if (!repoData) return false;

    // Upsert metrics in batches
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

      const { error } = await supabase
        .from('daily_metrics')
        .upsert(batch, { onConflict: 'repo_id,date' });

      if (error) {
        console.error('Error saving partial metrics batch:', error);
        return false;
      }
    }

    console.log(`Saved ${dailyMetrics.length} partial metrics for ${owner}/${repo}`);
    return true;
  } catch (error) {
    console.error('Error saving partial metrics:', error);
    return false;
  }
}

// Check for incomplete fetches that can be resumed
export async function getIncompleteFetches() {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('repositories')
      .select('*')
      .eq('fetch_in_progress', true);

    if (error) {
      console.error('Error checking incomplete fetches:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getIncompleteFetches:', error);
    return [];
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
