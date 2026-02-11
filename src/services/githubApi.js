import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';

export function createGitHubClient(token) {
  return new Octokit({ auth: token });
}

export function createGraphQLClient(token) {
  return graphql.defaults({
    headers: {
      authorization: `token ${token}`
    }
  });
}

export async function fetchRepoInfo(octokit, owner, repo) {
  const { data } = await octokit.repos.get({ owner, repo });
  return {
    name: data.full_name,
    description: data.description,
    createdAt: data.created_at,
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    language: data.language
  };
}

function isPaginationLimitError(error) {
  const message = error.message || error.response?.data?.message || '';
  return error.status === 422 && message.includes('pagination');
}

function isRateLimitError(error) {
  const status = error.status || error.response?.status;
  const message = error.message || error.response?.data?.message || '';

  return (
    status === 403 ||
    status === 429 ||
    message.toLowerCase().includes('rate limit') ||
    message.toLowerCase().includes('api rate limit')
  );
}

async function handleRateLimit(error, onProgress, type, fetched) {
  if (!isRateLimitError(error)) {
    return false;
  }

  const headers = error.response?.headers || {};
  const resetTime = headers['x-ratelimit-reset'] || headers['X-RateLimit-Reset'];

  let waitTime = 60000;

  if (resetTime) {
    const resetTimestamp = parseInt(resetTime) * 1000;
    waitTime = Math.max(0, resetTimestamp - Date.now()) + 5000;
  }

  waitTime = Math.min(waitTime, 3600000);

  const waitMinutes = Math.ceil(waitTime / 60000);
  console.log(`Rate limited on ${type} (fetched: ${fetched}). Waiting ${waitMinutes} minute(s) until reset...`);

  onProgress?.({
    type,
    fetched,
    rateLimit: true,
    waitTime,
    resetTime: resetTime ? new Date(parseInt(resetTime) * 1000).toLocaleTimeString() : null
  });

  const startTime = Date.now();
  while (Date.now() - startTime < waitTime) {
    const remaining = Math.ceil((waitTime - (Date.now() - startTime)) / 1000);
    onProgress?.({
      type,
      fetched,
      rateLimit: true,
      secondsRemaining: remaining
    });
    await sleep(1000);
  }

  onProgress?.({ type, fetched, rateLimit: false });
  console.log(`Rate limit wait complete for ${type}, resuming...`);
  return true;
}

// Fetch stargazers using GraphQL (cursor-based pagination, no 1000-page limit)
export async function fetchAllStargazersGraphQL(token, owner, repo, onProgress, startCursor = null) {
  const graphqlWithAuth = createGraphQLClient(token);
  const stargazers = [];
  let cursor = startCursor;
  let hasNextPage = true;
  let retryCount = 0;
  const maxRetries = 10;
  let lastCursor = cursor;
  let hitRateLimit = false;

  console.log(`Fetching stargazers via GraphQL${startCursor ? ` (resuming from cursor)` : ' (full fetch)'}...`);

  const query = `
    query($owner: String!, $repo: String!, $first: Int!, $after: String) {
      repository(owner: $owner, name: $repo) {
        stargazers(first: $first, after: $after, orderBy: {field: STARRED_AT, direction: ASC}) {
          edges {
            starredAt
            node {
              login
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
      rateLimit {
        remaining
        resetAt
      }
    }
  `;

  while (hasNextPage && retryCount < maxRetries) {
    try {
      const result = await graphqlWithAuth(query, {
        owner,
        repo,
        first: 100,
        after: cursor
      });

      const { edges, pageInfo } = result.repository.stargazers;
      const rateLimit = result.rateLimit;

      for (const edge of edges) {
        stargazers.push({
          user: edge.node.login,
          starredAt: edge.starredAt
        });
      }

      lastCursor = pageInfo.endCursor;
      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;

      onProgress?.({
        type: 'stars',
        fetched: stargazers.length,
        partial: false,
        cursor: lastCursor,
        rateLimit: rateLimit.remaining < 100,
        remaining: rateLimit.remaining
      });

      // Check rate limit
      if (rateLimit.remaining < 50) {
        const resetTime = new Date(rateLimit.resetAt).getTime();
        const waitTime = Math.max(0, resetTime - Date.now()) + 5000;
        console.log(`GraphQL rate limit low (${rateLimit.remaining} remaining), waiting ${Math.ceil(waitTime / 1000)}s...`);

        const startTime = Date.now();
        while (Date.now() - startTime < waitTime) {
          const remaining = Math.ceil((waitTime - (Date.now() - startTime)) / 1000);
          onProgress?.({
            type: 'stars',
            fetched: stargazers.length,
            rateLimit: true,
            secondsRemaining: remaining
          });
          await sleep(1000);
        }
        onProgress?.({ type: 'stars', fetched: stargazers.length, rateLimit: false });
      }

      retryCount = 0;
    } catch (error) {
      console.error('GraphQL error fetching stars:', error.message);

      // Check for rate limit error
      if (error.message?.includes('rate limit') || error.status === 403) {
        hitRateLimit = true;
        console.log('Hit GraphQL rate limit, saving progress...');
        break;
      }

      retryCount++;
      if (retryCount >= maxRetries) {
        console.error('Max retries reached for GraphQL stargazers fetch');
        break;
      }

      // Wait before retry
      await sleep(5000);
    }
  }

  return {
    stargazers,
    lastCursor,
    hasMorePages: hasNextPage,
    hitRateLimit
  };
}

// Fetch stargazers using REST API - supports resuming from a specific page for large repos
export async function fetchAllStargazers(octokit, owner, repo, onProgress, sinceDate = null, startPage = 1) {
  const stargazers = [];
  let page = startPage;
  const perPage = 100;
  let retryCount = 0;
  const maxRetries = 10;
  let hitPaginationLimit = false;
  let lastPage = page;

  console.log(`Fetching stargazers${startPage > 1 ? ` (resuming from page ${startPage})` : ''}${sinceDate ? ` since ${sinceDate}` : ' (full fetch)'}...`);

  while (retryCount < maxRetries) {
    try {
      const { data, headers } = await octokit.request('GET /repos/{owner}/{repo}/stargazers', {
        owner,
        repo,
        per_page: perPage,
        page,
        headers: {
          accept: 'application/vnd.github.star+json'
        }
      });

      if (data.length === 0) break;

      for (const s of data) {
        stargazers.push({
          user: s.user.login,
          starredAt: s.starred_at
        });
      }

      lastPage = page;
      onProgress?.({ type: 'stars', fetched: stargazers.length + ((startPage - 1) * perPage), partial: false, page });

      if (data.length < perPage) break;
      page++;
      retryCount = 0;

      await checkRateLimit(headers, onProgress, 'stars', stargazers.length);
    } catch (error) {
      console.error(`Error fetching stars (page ${page}):`, error.message);

      if (isPaginationLimitError(error)) {
        console.warn(`Stars: Hit pagination limit at page ${page} (${stargazers.length} items this run)`);
        hitPaginationLimit = true;
        onProgress?.({ type: 'stars', fetched: stargazers.length + ((startPage - 1) * perPage), partial: true, page: lastPage });
        break;
      }

      if (await handleRateLimit(error, onProgress, 'stars', stargazers.length)) {
        retryCount++;
        continue;
      }

      throw error;
    }
  }

  return {
    stargazers,
    hitPaginationLimit,
    lastPage,
    startPage
  };
}

export async function fetchAllForks(octokit, owner, repo, onProgress, startPage = 1) {
  const forks = [];
  let page = startPage;
  const perPage = 100;
  let retryCount = 0;
  const maxRetries = 10;
  let hitPaginationLimit = false;
  let lastPage = page;

  console.log(`Fetching forks${startPage > 1 ? ` (resuming from page ${startPage})` : ' (full fetch)'}...`);

  while (retryCount < maxRetries) {
    try {
      const { data, headers } = await octokit.repos.listForks({
        owner,
        repo,
        per_page: perPage,
        page,
        sort: 'oldest'
      });

      if (data.length === 0) break;

      for (const f of data) {
        forks.push({
          owner: f.owner.login,
          createdAt: f.created_at
        });
      }

      lastPage = page;
      onProgress?.({ type: 'forks', fetched: forks.length + ((startPage - 1) * perPage), partial: false, page });

      if (data.length < perPage) break;
      page++;
      retryCount = 0;

      await checkRateLimit(headers, onProgress, 'forks', forks.length);
    } catch (error) {
      console.error(`Error fetching forks (page ${page}):`, error.message);

      if (isPaginationLimitError(error)) {
        console.warn(`Forks: Hit pagination limit at page ${page} (${forks.length} items this run)`);
        hitPaginationLimit = true;
        onProgress?.({ type: 'forks', fetched: forks.length + ((startPage - 1) * perPage), partial: true, page: lastPage });
        break;
      }

      if (await handleRateLimit(error, onProgress, 'forks', forks.length)) {
        retryCount++;
        continue;
      }

      throw error;
    }
  }

  return {
    forks,
    hitPaginationLimit,
    lastPage,
    startPage
  };
}

export async function fetchAllIssues(octokit, owner, repo, onProgress, sinceDate = null) {
  const issues = [];
  let page = 1;
  const perPage = 100;
  let retryCount = 0;
  const maxRetries = 10;
  let hitPaginationLimit = false;
  let lastDate = null;

  console.log(`Fetching issues${sinceDate ? ` since ${sinceDate}` : ' (full fetch)'}...`);

  while (retryCount < maxRetries) {
    try {
      const params = {
        owner,
        repo,
        state: 'all',
        per_page: perPage,
        page,
        sort: 'created',
        direction: 'asc'
      };

      // Use 'since' parameter for incremental fetch
      if (sinceDate) {
        params.since = new Date(sinceDate).toISOString();
      }

      const { data, headers } = await octokit.issues.listForRepo(params);

      if (data.length === 0) break;

      const realIssues = data.filter(i => !i.pull_request);

      for (const i of realIssues) {
        issues.push({
          number: i.number,
          state: i.state,
          createdAt: i.created_at,
          closedAt: i.closed_at
        });
        // Track the latest date we've seen
        const issueDate = i.created_at.split('T')[0];
        if (!lastDate || issueDate > lastDate) {
          lastDate = issueDate;
        }
      }

      onProgress?.({ type: 'issues', fetched: issues.length, partial: false });

      if (data.length < perPage) break;
      page++;
      retryCount = 0;

      await checkRateLimit(headers, onProgress, 'issues', issues.length);
    } catch (error) {
      console.error(`Error fetching issues (page ${page}):`, error.message);

      if (isPaginationLimitError(error)) {
        console.warn(`Issues: Hit pagination limit at ${issues.length} items`);
        hitPaginationLimit = true;
        onProgress?.({ type: 'issues', fetched: issues.length, partial: true });
        break;
      }

      if (await handleRateLimit(error, onProgress, 'issues', issues.length)) {
        retryCount++;
        continue;
      }

      throw error;
    }
  }

  return {
    issues,
    hitPaginationLimit,
    lastDate
  };
}

export async function fetchAllPullRequests(octokit, owner, repo, onProgress, startPage = 1) {
  const prs = [];
  let page = startPage;
  const perPage = 100;
  let retryCount = 0;
  const maxRetries = 10;
  let hitPaginationLimit = false;
  let lastPage = page;

  console.log(`Fetching PRs${startPage > 1 ? ` (resuming from page ${startPage})` : ' (full fetch)'}...`);

  while (retryCount < maxRetries) {
    try {
      const { data, headers } = await octokit.pulls.list({
        owner,
        repo,
        state: 'all',
        per_page: perPage,
        page,
        sort: 'created',
        direction: 'asc'
      });

      if (data.length === 0) break;

      for (const pr of data) {
        prs.push({
          number: pr.number,
          state: pr.state,
          createdAt: pr.created_at,
          closedAt: pr.closed_at,
          mergedAt: pr.merged_at
        });
      }

      lastPage = page;
      onProgress?.({ type: 'prs', fetched: prs.length + ((startPage - 1) * perPage), partial: false, page });

      if (data.length < perPage) break;
      page++;
      retryCount = 0;

      await checkRateLimit(headers, onProgress, 'prs', prs.length);
    } catch (error) {
      console.error(`Error fetching PRs (page ${page}):`, error.message);

      if (isPaginationLimitError(error)) {
        console.warn(`PRs: Hit pagination limit at page ${page} (${prs.length} items this run)`);
        hitPaginationLimit = true;
        onProgress?.({ type: 'prs', fetched: prs.length + ((startPage - 1) * perPage), partial: true, page: lastPage });
        break;
      }

      if (await handleRateLimit(error, onProgress, 'prs', prs.length)) {
        retryCount++;
        continue;
      }

      throw error;
    }
  }

  return {
    prs,
    hitPaginationLimit,
    lastPage,
    startPage
  };
}

export async function fetchAllContributors(octokit, owner, repo, onProgress) {
  const contributors = [];
  let page = 1;
  const perPage = 100;
  let retryCount = 0;
  const maxRetries = 10;

  while (retryCount < maxRetries) {
    try {
      const { data, headers } = await octokit.repos.listContributors({
        owner,
        repo,
        per_page: perPage,
        page,
        anon: 'true'
      });

      if (data.length === 0) break;

      contributors.push(...data.map(c => ({
        login: c.login || c.email,
        contributions: c.contributions
      })));

      onProgress?.({ type: 'contributors', fetched: contributors.length, partial: false });

      if (data.length < perPage) break;
      page++;
      retryCount = 0;

      await checkRateLimit(headers, onProgress, 'contributors', contributors.length);
    } catch (error) {
      console.error(`Error fetching contributors (page ${page}):`, error.message);

      if (isPaginationLimitError(error)) {
        console.warn(`Contributors: Hit pagination limit at ${contributors.length} items`);
        onProgress?.({ type: 'contributors', fetched: contributors.length, partial: true });
        break;
      }

      if (await handleRateLimit(error, onProgress, 'contributors', contributors.length)) {
        retryCount++;
        continue;
      }

      throw error;
    }
  }

  return contributors;
}

export async function fetchContributorCommits(octokit, owner, repo, onProgress, sinceDate = null) {
  const commits = [];
  let page = 1;
  const perPage = 100;
  let retryCount = 0;
  const maxRetries = 10;
  let hitPaginationLimit = false;
  let lastDate = null;

  console.log(`Fetching commits${sinceDate ? ` since ${sinceDate}` : ' (full fetch)'}...`);

  while (retryCount < maxRetries) {
    try {
      const params = {
        owner,
        repo,
        per_page: perPage,
        page
      };

      if (sinceDate) {
        params.since = new Date(sinceDate).toISOString();
      }

      const { data, headers } = await octokit.repos.listCommits(params);

      if (data.length === 0) break;

      for (const c of data) {
        commits.push({
          sha: c.sha,
          author: c.author?.login || c.commit?.author?.name,
          date: c.commit.author.date
        });
        // Track the latest date we've seen
        const commitDate = c.commit.author.date.split('T')[0];
        if (!lastDate || commitDate > lastDate) {
          lastDate = commitDate;
        }
      }

      onProgress?.({ type: 'commits', fetched: commits.length, partial: false });

      if (data.length < perPage) break;
      page++;
      retryCount = 0;

      await checkRateLimit(headers, onProgress, 'commits', commits.length);
    } catch (error) {
      console.error(`Error fetching commits (page ${page}):`, error.message);

      if (isPaginationLimitError(error)) {
        console.warn(`Commits: Hit pagination limit at ${commits.length} items`);
        hitPaginationLimit = true;
        onProgress?.({ type: 'commits', fetched: commits.length, partial: true });
        break;
      }

      if (await handleRateLimit(error, onProgress, 'commits', commits.length)) {
        retryCount++;
        continue;
      }

      throw error;
    }
  }

  return {
    commits,
    hitPaginationLimit,
    lastDate
  };
}

async function checkRateLimit(headers, onProgress, type, fetched) {
  const remaining = parseInt(headers['x-ratelimit-remaining'] || '100');

  if (remaining < 10) {
    const resetTime = parseInt(headers['x-ratelimit-reset'] || '0') * 1000;
    const waitTime = Math.max(0, resetTime - Date.now()) + 1000;

    console.log(`Rate limit low (${remaining} remaining), waiting ${Math.ceil(waitTime / 1000)}s...`);

    const startTime = Date.now();
    while (Date.now() - startTime < waitTime) {
      const remaining = Math.ceil((waitTime - (Date.now() - startTime)) / 1000);
      onProgress?.({
        type,
        fetched,
        rateLimit: true,
        secondsRemaining: remaining
      });
      await sleep(1000);
    }
    onProgress?.({ type, fetched, rateLimit: false });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
