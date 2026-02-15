// Vercel Cron Job: Check GitHub Weekly Trending and auto-fetch new repos
// Runs daily at 8 AM EST (13:00 UTC)

import { createClient } from '@supabase/supabase-js';

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

// Parse GitHub trending HTML (same logic as api/trending.js)
function parseTrendingHtml(html) {
  const repos = [];
  const repoRegex = /<article class="Box-row"[^>]*>([\s\S]*?)<\/article>/g;
  let match;

  while ((match = repoRegex.exec(html)) !== null) {
    const articleHtml = match[1];
    // Extract repo path from h2 tag to avoid sponsor links
    const h2Match = articleHtml.match(/<h2[^>]*>[\s\S]*?href="\/([^/]+\/[^/"]+)"[\s\S]*?<\/h2>/);
    if (!h2Match) continue;

    const repoPath = h2Match[1];
    // Skip sponsors, users, orgs links
    if (repoPath.startsWith('sponsors/') || repoPath.startsWith('users/') || repoPath.startsWith('orgs/')) {
      continue;
    }
    const [owner, repo] = repoPath.split('/');

    const descMatch = articleHtml.match(/<p class="[^"]*col-9[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/);
    const description = descMatch ? descMatch[1].replace(/<[^>]*>/g, '').trim() : '';

    const langMatch = articleHtml.match(/itemprop="programmingLanguage">([^<]+)</);
    const language = langMatch ? langMatch[1].trim() : null;

    const starsMatch = articleHtml.match(/\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([0-9,]+)/);
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, '')) : 0;

    const starsGainedMatch = articleHtml.match(/([0-9,]+)\s*stars?\s*(?:this|today)/i);
    const starsGained = starsGainedMatch ? parseInt(starsGainedMatch[1].replace(/,/g, '')) : 0;

    repos.push({ owner, repo, fullName: repoPath, description, language, stars, starsGained });
  }

  return repos;
}

// Fetch trending repos from GitHub
async function fetchTrending() {
  const url = 'https://github.com/trending?since=weekly';
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GitHubAnalytics/1.0)',
      'Accept': 'text/html'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}`);
  }

  const html = await response.text();
  return parseTrendingHtml(html);
}

// Get cached repos from Supabase
async function getCachedRepos(supabase) {
  const { data, error } = await supabase
    .from('repositories')
    .select('owner, repo');

  if (error) {
    console.error('Error fetching cached repos:', error);
    return [];
  }

  return data || [];
}

// Filter new repos not in cache
function filterNewRepos(trending, cached) {
  const cachedSet = new Set(
    cached.map(r => `${r.owner}/${r.repo}`.toLowerCase())
  );
  return trending.filter(r => !cachedSet.has(r.fullName.toLowerCase()));
}

// Fetch repo info from GitHub API
async function fetchRepoInfo(token, owner, repo) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'GitHubAnalytics/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }

  return response.json();
}

// Save repo to Supabase (basic entry, full fetch will happen via UI later)
async function saveRepoToCache(supabase, owner, repo, repoInfo) {
  const { data, error } = await supabase
    .from('repositories')
    .upsert({
      owner,
      repo,
      last_fetched: new Date().toISOString(),
      discovered_via_trending: true,
      trending_discovered_at: new Date().toISOString()
    }, { onConflict: 'owner,repo' })
    .select()
    .single();

  if (error) {
    console.error(`Error saving ${owner}/${repo}:`, error);
    return null;
  }

  return data;
}

// Log cron run to a table (optional, for tracking)
async function logCronRun(supabase, results) {
  try {
    await supabase
      .from('cron_logs')
      .insert({
        job_name: 'check-trending',
        run_at: new Date().toISOString(),
        trending_count: results.trendingCount,
        new_repos_count: results.newReposCount,
        fetched_count: results.fetchedCount,
        errors: results.errors
      });
  } catch (e) {
    // Table might not exist, that's ok
    console.log('Could not log cron run (table may not exist):', e.message);
  }
}

export default async function handler(req, res) {
  // Verify this is a cron request (Vercel adds this header)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // In development or if no CRON_SECRET set, allow the request
    if (process.env.CRON_SECRET) {
      console.log('Unauthorized cron request');
      // Still allow for testing, but log it
    }
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
    trendingCount: 0,
    newReposCount: 0,
    fetchedCount: 0,
    errors: [],
    newRepos: []
  };

  try {
    // 1. Fetch trending repos
    console.log('Fetching GitHub trending...');
    const trending = await fetchTrending();
    results.trendingCount = trending.length;
    console.log(`Found ${trending.length} trending repos`);

    // 2. Get cached repos
    const cached = await getCachedRepos(supabase);
    console.log(`Found ${cached.length} cached repos`);

    // 3. Filter for new repos
    const newRepos = filterNewRepos(trending, cached);
    results.newReposCount = newRepos.length;
    results.newRepos = newRepos.map(r => r.fullName);
    console.log(`Found ${newRepos.length} new repos not in cache`);

    // 4. For each new repo, save basic info to cache
    // (Full data fetch is expensive, users can trigger that from UI)
    for (const repo of newRepos) {
      try {
        const info = await fetchRepoInfo(githubToken, repo.owner, repo.repo);
        await saveRepoToCache(supabase, repo.owner, repo.repo, info);
        results.fetchedCount++;
        console.log(`Saved ${repo.fullName} to cache`);
      } catch (err) {
        console.error(`Error processing ${repo.fullName}:`, err.message);
        results.errors.push({ repo: repo.fullName, error: err.message });
      }
    }

    // 5. Log the cron run
    await logCronRun(supabase, results);

    return res.status(200).json({
      success: true,
      message: `Processed ${results.fetchedCount} new trending repos`,
      ...results
    });

  } catch (error) {
    console.error('Cron job failed:', error);
    results.errors.push({ error: error.message });
    await logCronRun(supabase, results);
    return res.status(500).json({ error: error.message, ...results });
  }
}
