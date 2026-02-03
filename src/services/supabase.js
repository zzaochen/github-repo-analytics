import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export async function getRepoFromCache(owner, repo) {
  if (!supabase) return null;

  try {
    const { data: repoData, error: repoError } = await supabase
      .from('repositories')
      .select('*')
      .eq('owner', owner)
      .eq('repo', repo)
      .single();

    if (repoError || !repoData) return null;

    const { data: metrics, error: metricsError } = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('repo_id', repoData.id)
      .order('date', { ascending: true });

    if (metricsError) return null;

    return {
      repository: repoData,
      metrics: metrics || []
    };
  } catch (error) {
    console.error('Error fetching from cache:', error);
    return null;
  }
}

export async function saveRepoToCache(owner, repo, dailyMetrics) {
  if (!supabase) return null;

  try {
    // Upsert repository
    const { data: repoData, error: repoError } = await supabase
      .from('repositories')
      .upsert(
        { owner, repo, last_fetched: new Date().toISOString() },
        { onConflict: 'owner,repo' }
      )
      .select()
      .single();

    if (repoError) {
      console.error('Error saving repository:', repoError);
      return null;
    }

    // Delete existing metrics for this repo
    await supabase
      .from('daily_metrics')
      .delete()
      .eq('repo_id', repoData.id);

    // Insert new metrics in batches
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
        .insert(batch);

      if (error) {
        console.error('Error saving metrics batch:', error);
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
