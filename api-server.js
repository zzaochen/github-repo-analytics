// Simple local API server for development
import http from 'http';
import { URL } from 'url';

const PORT = 3001;

async function fetchTrending(since = 'weekly') {
  const url = `https://github.com/trending?since=${since}`;

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
    const description = descMatch
      ? descMatch[1].replace(/<[^>]*>/g, '').trim()
      : '';

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

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/trending') {
    try {
      const since = url.searchParams.get('since') || 'weekly';
      const repos = await fetchTrending(since);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ repos, count: repos.length }));
    } catch (error) {
      console.error('Error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
  console.log(`Test: http://localhost:${PORT}/api/trending`);
});
