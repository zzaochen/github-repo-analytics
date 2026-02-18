// GitHub Public Repo Discovery Agent
// Enumerates all public GitHub repos using the /repositories endpoint

import { supabase } from './supabase';

const GITHUB_API = 'https://api.github.com';
const BATCH_SIZE = 100; // Max repos per request
const SAVE_BATCH_SIZE = 100; // Save to DB every N repos

// Get the last processed repo ID from progress table
export async function getLastRepoId() {
  if (!supabase) return 0;

  const { data, error } = await supabase
    .from('collection_progress')
    .select('last_repo_id, status')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return 0;
  return data.last_repo_id || 0;
}

// Start or resume a collection session
export async function startCollectionSession(resumeFromId = null) {
  if (!supabase) return null;

  const lastId = resumeFromId ?? await getLastRepoId();

  const { data, error } = await supabase
    .from('collection_progress')
    .insert({
      last_repo_id: lastId,
      repos_collected: 0,
      status: 'running'
    })
    .select()
    .single();

  if (error) {
    console.error('Error starting collection session:', error);
    return null;
  }

  return data;
}

// Update collection progress
export async function updateProgress(sessionId, lastRepoId, reposCollected, status = 'running') {
  if (!supabase) return;

  await supabase
    .from('collection_progress')
    .update({
      last_repo_id: lastRepoId,
      repos_collected: reposCollected,
      updated_at: new Date().toISOString(),
      status
    })
    .eq('id', sessionId);
}

// Fetch repos from GitHub API
export async function fetchReposFromGitHub(sinceId, token) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'GitHub-Repo-Analytics'
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${GITHUB_API}/repositories?since=${sinceId}&per_page=${BATCH_SIZE}`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    const rateLimitReset = response.headers.get('x-ratelimit-reset');

    if (response.status === 403 && rateLimitRemaining === '0') {
      const resetTime = new Date(parseInt(rateLimitReset) * 1000);
      throw new Error(`Rate limited. Resets at ${resetTime.toISOString()}`);
    }

    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const repos = await response.json();

  // Get rate limit info
  const rateLimit = {
    remaining: parseInt(response.headers.get('x-ratelimit-remaining') || '0'),
    limit: parseInt(response.headers.get('x-ratelimit-limit') || '0'),
    reset: new Date(parseInt(response.headers.get('x-ratelimit-reset') || '0') * 1000)
  };

  return { repos, rateLimit };
}

// Transform GitHub repo data to our schema
function transformRepo(repo) {
  return {
    github_id: repo.id,
    full_name: repo.full_name,
    owner: repo.owner?.login || repo.full_name.split('/')[0],
    name: repo.name,
    description: repo.description?.substring(0, 1000) || null, // Truncate long descriptions
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    watchers: repo.watchers_count || 0,
    language: repo.language || null,
    size_kb: repo.size || 0,
    is_fork: repo.fork || false,
    is_archived: repo.archived || false,
    created_at: repo.created_at,
    updated_at: repo.updated_at,
    pushed_at: repo.pushed_at,
    discovered_at: new Date().toISOString()
  };
}

// Save repos to Supabase
export async function saveRepos(repos) {
  if (!supabase || repos.length === 0) return { saved: 0, errors: 0 };

  const transformed = repos.map(transformRepo);

  // Upsert to handle duplicates
  const { data, error } = await supabase
    .from('discovered_repos')
    .upsert(transformed, {
      onConflict: 'github_id',
      ignoreDuplicates: false // Update existing records
    });

  if (error) {
    console.error('Error saving repos:', error);
    return { saved: 0, errors: repos.length };
  }

  return { saved: repos.length, errors: 0 };
}

// Main collection function with progress callbacks
export async function collectRepos({
  token,
  maxRepos = Infinity,
  onProgress = () => {},
  onRateLimit = () => {},
  shouldStop = () => false
}) {
  // Start or resume session
  const session = await startCollectionSession();
  if (!session) {
    throw new Error('Failed to start collection session');
  }

  let sinceId = session.last_repo_id;
  let totalCollected = 0;
  let batch = [];

  console.log(`Starting collection from repo ID: ${sinceId}`);

  try {
    while (totalCollected < maxRepos && !shouldStop()) {
      // Fetch batch from GitHub
      const { repos, rateLimit } = await fetchReposFromGitHub(sinceId, token);

      if (repos.length === 0) {
        console.log('No more repos to fetch');
        break;
      }

      // Add to batch
      batch = batch.concat(repos);

      // Update sinceId to last repo in response
      sinceId = repos[repos.length - 1].id;

      // Save when batch is full
      if (batch.length >= SAVE_BATCH_SIZE) {
        const { saved, errors } = await saveRepos(batch);
        totalCollected += saved;

        // Update progress
        await updateProgress(session.id, sinceId, totalCollected);

        onProgress({
          totalCollected,
          lastRepoId: sinceId,
          rateLimit,
          batchSize: batch.length
        });

        batch = [];
      }

      // Check rate limit
      if (rateLimit.remaining < 10) {
        onRateLimit(rateLimit);

        // Wait until rate limit resets
        const waitMs = Math.max(0, rateLimit.reset.getTime() - Date.now() + 1000);
        console.log(`Rate limit low (${rateLimit.remaining}), waiting ${Math.round(waitMs / 1000)}s`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }

      // Small delay to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Save remaining batch
    if (batch.length > 0) {
      const { saved } = await saveRepos(batch);
      totalCollected += saved;
      await updateProgress(session.id, sinceId, totalCollected, 'completed');
    } else {
      await updateProgress(session.id, sinceId, totalCollected, 'completed');
    }

    return {
      success: true,
      totalCollected,
      lastRepoId: sinceId,
      sessionId: session.id
    };
  } catch (error) {
    // Save progress on error
    if (batch.length > 0) {
      await saveRepos(batch);
    }
    await updateProgress(session.id, sinceId, totalCollected, 'error');

    throw error;
  }
}

// Get collection stats
export async function getCollectionStats() {
  if (!supabase) return null;

  const [reposResult, progressResult] = await Promise.all([
    supabase
      .from('discovered_repos')
      .select('github_id', { count: 'exact', head: true }),
    supabase
      .from('collection_progress')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
  ]);

  const totalRepos = reposResult.count || 0;
  const lastProgress = progressResult.data;

  // Get some aggregate stats
  const { data: statsData } = await supabase
    .from('discovered_repos')
    .select('language, stars')
    .order('stars', { ascending: false })
    .limit(10000); // Sample for stats

  const languageCounts = {};
  let totalStars = 0;

  if (statsData) {
    statsData.forEach(repo => {
      if (repo.language) {
        languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
      }
      totalStars += repo.stars || 0;
    });
  }

  // Sort languages by count
  const topLanguages = Object.entries(languageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([lang, count]) => ({ language: lang, count }));

  return {
    totalRepos,
    lastProgress,
    topLanguages,
    sampleTotalStars: totalStars
  };
}

// Get discovered repos with filters
export async function getDiscoveredRepos({
  limit = 100,
  offset = 0,
  minStars = 0,
  language = null,
  sortBy = 'stars',
  sortOrder = 'desc'
} = {}) {
  if (!supabase) return [];

  let query = supabase
    .from('discovered_repos')
    .select('*')
    .gte('stars', minStars);

  if (language) {
    query = query.eq('language', language);
  }

  query = query
    .order(sortBy, { ascending: sortOrder === 'asc' })
    .range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching discovered repos:', error);
    return [];
  }

  return data || [];
}
