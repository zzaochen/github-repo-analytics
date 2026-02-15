// Serverless API route to fetch GitHub trending repos (avoids CORS issues)

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const since = req.query.since || 'weekly';
  const url = `https://github.com/trending?since=${since}`;

  try {
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
    const repos = parseTrendingHtml(html);

    return res.status(200).json({ repos, count: repos.length });
  } catch (error) {
    console.error('Error fetching trending:', error);
    return res.status(500).json({ error: error.message });
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

    // Stars count is after SVG: <a href=".../stargazers">...<svg>...</svg> 21,536</a>
    const starsMatch = articleHtml.match(/\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([0-9,]+)/);
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, '')) : 0;

    // Stars gained this week/today
    const starsGainedMatch = articleHtml.match(/([0-9,]+)\s*stars?\s*(?:this|today)/i);
    const starsGained = starsGainedMatch ? parseInt(starsGainedMatch[1].replace(/,/g, '')) : 0;

    // Forks count is after SVG: <a href=".../forks">...<svg>...</svg> 2,162</a>
    const forksMatch = articleHtml.match(/\/forks"[^>]*>[\s\S]*?<\/svg>\s*([0-9,]+)/);
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
