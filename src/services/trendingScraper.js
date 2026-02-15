// Fetch GitHub trending repositories via API route (avoids CORS)

export async function fetchTrendingRepos(since = 'weekly') {
  // Use API route to avoid CORS issues
  const apiUrl = import.meta.env.DEV
    ? `http://localhost:3001/api/trending?since=${since}`
    : `/api/trending?since=${since}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch trending: ${response.status}`);
    }

    const data = await response.json();
    return data.repos;
  } catch (error) {
    console.error('Error fetching trending repos:', error);
    throw error;
  }
}

function parseTrendingHtml(html) {
  const repos = [];

  // Match repository rows - each repo is in an <article> tag with class "Box-row"
  const repoRegex = /<article class="Box-row"[^>]*>([\s\S]*?)<\/article>/g;
  let match;

  while ((match = repoRegex.exec(html)) !== null) {
    const articleHtml = match[1];

    // Extract repo path from h2 with class "h3" (the repo name heading)
    const h2Match = articleHtml.match(/<h2[^>]*class="[^"]*h3[^"]*"[^>]*>[\s\S]*?href="\/([^/]+\/[^/"]+)"[\s\S]*?<\/h2>/);
    if (!h2Match) continue;

    const repoPath = h2Match[1];
    const [owner, repo] = repoPath.split('/');

    // Extract description
    const descMatch = articleHtml.match(/<p class="[^"]*col-9[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]*>/g, '').trim()
      : '';

    // Extract language
    const langMatch = articleHtml.match(/itemprop="programmingLanguage">([^<]+)</);
    const language = langMatch ? langMatch[1].trim() : null;

    // Extract stars count
    const starsMatch = articleHtml.match(/href="\/[^/]+\/[^/]+\/stargazers"[^>]*>\s*([0-9,]+)\s*<\/a>/);
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, '')) : 0;

    // Extract stars gained this period
    const starsGainedMatch = articleHtml.match(/(\d+(?:,\d+)?)\s*stars?\s*(?:this|today)/i);
    const starsGained = starsGainedMatch ? parseInt(starsGainedMatch[1].replace(/,/g, '')) : 0;

    // Extract forks count
    const forksMatch = articleHtml.match(/href="\/[^/]+\/[^/]+\/forks"[^>]*>\s*([0-9,]+)\s*<\/a>/);
    const forks = forksMatch ? parseInt(forksMatch[1].replace(/,/g, '')) : 0;

    repos.push({
      owner,
      repo,
      fullName: repoPath,
      description,
      language,
      stars,
      starsGained,
      forks
    });
  }

  return repos;
}

// Filter out repos that are already cached
export function filterNewRepos(trendingRepos, cachedRepos) {
  const cachedSet = new Set(
    cachedRepos.map(r => `${r.owner}/${r.repo}`.toLowerCase())
  );

  return trendingRepos.filter(
    r => !cachedSet.has(r.fullName.toLowerCase())
  );
}
