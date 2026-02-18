// API endpoint to run GitHub repo collection
// Can be called manually or via cron

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const GITHUB_API = 'https://api.github.com';
const BATCH_SIZE = 100;
const MAX_REPOS_PER_RUN = 10000; // Limit per invocation to avoid timeout
const SAVE_BATCH_SIZE = 100;

async function getLastRepoId() {
  if (!supabase) return 0;

  const { data, error } = await supabase
    .from('collection_progress')
    .select('last_repo_id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return 0;
  return data.last_repo_id || 0;
}

async function startSession(lastId) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('collection_progress')
    .insert({
      last_repo_id: lastId,
      repos_collected: 0,
      status: 'running'
    })
    .select()
    .single();

  return error ? null : data;
}

async function updateProgress(sessionId, lastRepoId, reposCollected, status = 'running') {
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

async function fetchRepos(sinceId, token) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'GitHub-Repo-Analytics'
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(
    `${GITHUB_API}/repositories?since=${sinceId}&per_page=${BATCH_SIZE}`,
    { headers }
  );

  if (!response.ok) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    if (response.status === 403 && rateLimitRemaining === '0') {
      const resetTime = new Date(parseInt(response.headers.get('x-ratelimit-reset')) * 1000);
      return { repos: [], rateLimit: { remaining: 0, reset: resetTime }, rateLimited: true };
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return {
    repos: await response.json(),
    rateLimit: {
      remaining: parseInt(response.headers.get('x-ratelimit-remaining') || '0'),
      reset: new Date(parseInt(response.headers.get('x-ratelimit-reset') || '0') * 1000)
    },
    rateLimited: false
  };
}

function transformRepo(repo) {
  return {
    github_id: repo.id,
    full_name: repo.full_name,
    owner: repo.owner?.login || repo.full_name?.split('/')[0] || 'unknown',
    name: repo.name,
    description: repo.description?.substring(0, 1000) || null,
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

async function saveRepos(repos) {
  if (!supabase || repos.length === 0) return 0;

  const transformed = repos.map(transformRepo);

  const { error } = await supabase
    .from('discovered_repos')
    .upsert(transformed, { onConflict: 'github_id' });

  if (error) {
    console.error('Error saving repos:', error);
    return 0;
  }

  return repos.length;
}

export default async function handler(req, res) {
  // Only allow POST or GET with secret
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  // Allow if: has valid cron secret OR has GitHub token in body
  const isAuthorized =
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    req.body?.token ||
    req.query?.manual === 'true';

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const token = req.body?.token || process.env.GITHUB_TOKEN;
  const maxRepos = Math.min(
    parseInt(req.body?.maxRepos || req.query?.maxRepos || MAX_REPOS_PER_RUN),
    MAX_REPOS_PER_RUN
  );

  try {
    const startTime = Date.now();
    let sinceId = await getLastRepoId();
    const session = await startSession(sinceId);

    if (!session) {
      return res.status(500).json({ error: 'Failed to start session' });
    }

    let totalCollected = 0;
    let batch = [];
    let rateLimitInfo = null;

    console.log(`Starting collection from ID: ${sinceId}, max: ${maxRepos}`);

    while (totalCollected < maxRepos) {
      const { repos, rateLimit, rateLimited } = await fetchRepos(sinceId, token);

      if (rateLimited) {
        console.log('Rate limited, stopping');
        rateLimitInfo = rateLimit;
        break;
      }

      if (repos.length === 0) {
        console.log('No more repos');
        break;
      }

      batch = batch.concat(repos);
      sinceId = repos[repos.length - 1].id;

      if (batch.length >= SAVE_BATCH_SIZE) {
        const saved = await saveRepos(batch);
        totalCollected += saved;
        await updateProgress(session.id, sinceId, totalCollected);
        batch = [];

        // Check elapsed time (Vercel has 10s limit for hobby, 60s for pro)
        if (Date.now() - startTime > 55000) {
          console.log('Approaching timeout, stopping');
          break;
        }
      }

      rateLimitInfo = rateLimit;

      // Small delay
      await new Promise(r => setTimeout(r, 50));
    }

    // Save remaining
    if (batch.length > 0) {
      const saved = await saveRepos(batch);
      totalCollected += saved;
    }

    await updateProgress(session.id, sinceId, totalCollected, 'completed');

    const elapsed = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      collected: totalCollected,
      lastRepoId: sinceId,
      sessionId: session.id,
      elapsedMs: elapsed,
      rateLimit: rateLimitInfo
    });
  } catch (error) {
    console.error('Collection error:', error);
    return res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
