import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';

// Number of parallel requests to make (balance between speed and rate limits)
const PARALLEL_REQUESTS = 5;

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

// Helper to fetch multiple pages in parallel
async function fetchPagesInParallel(fetchFn, startPage, numPages) {
  const promises = [];
  for (let i = 0; i < numPages; i++) {
    promises.push(fetchFn(startPage + i));
  }
  return Promise.allSettled(promises);
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
// onSave callback is called periodically to save progress
export async function fetchAllStargazersGraphQL(token, owner, repo, onProgress, startCursor = null, onSave = null) {
  const graphqlWithAuth = createGraphQLClient(token);
  const stargazers = [];
  let cursor = startCursor;
  let hasNextPage = true;
  let retryCount = 0;
  const maxRetries = 10;
  let lastCursor = cursor;
  let hitRateLimit = false;
  const SAVE_INTERVAL = 500; // Save every 500 items
  let lastSaveCount = 0;

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

      // Save progress incrementally
      if (onSave && stargazers.length - lastSaveCount >= SAVE_INTERVAL) {
        console.log(`Saving stars progress: ${stargazers.length} items, cursor: ${lastCursor}`);
        await onSave({
          type: 'stars',
          data: stargazers.slice(lastSaveCount), // Only save new items since last save
          cursor: lastCursor,
          hasMore: hasNextPage
        });
        lastSaveCount = stargazers.length;
      }

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
        // Save remaining data before breaking
        if (onSave && stargazers.length > lastSaveCount) {
          await onSave({
            type: 'stars',
            data: stargazers.slice(lastSaveCount),
            cursor: lastCursor,
            hasMore: true
          });
        }
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

  // Final save of any remaining data
  if (onSave && stargazers.length > lastSaveCount) {
    console.log(`Final save for stars: ${stargazers.length - lastSaveCount} items`);
    await onSave({
      type: 'stars',
      data: stargazers.slice(lastSaveCount),
      cursor: lastCursor,
      hasMore: hasNextPage
    });
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

export async function fetchAllForks(octokit, owner, repo, onProgress, startPage = 1, onSave = null) {
  const forks = [];
  let currentPage = startPage;
  const perPage = 100;
  let hitPaginationLimit = false;
  let lastPage = currentPage;
  const SAVE_INTERVAL = 1000;
  let lastSaveCount = 0;
  let hasMore = true;

  console.log(`Fetching forks${startPage > 1 ? ` (resuming from page ${startPage})` : ' (full fetch)'} with ${PARALLEL_REQUESTS}x parallelism...`);

  while (hasMore) {
    // Fetch multiple pages in parallel
    const fetchPage = async (page) => {
      const { data, headers } = await octokit.repos.listForks({
        owner,
        repo,
        per_page: perPage,
        page,
        sort: 'oldest'
      });
      return { data, headers, page };
    };

    try {
      const results = await fetchPagesInParallel(fetchPage, currentPage, PARALLEL_REQUESTS);

      let gotEmptyPage = false;
      let gotPartialPage = false;
      let lowestRateLimit = Infinity;
      let rateLimitHeaders = null;

      // Process results in order
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          const error = result.reason;
          if (isPaginationLimitError(error)) {
            hitPaginationLimit = true;
            gotEmptyPage = true;
            break;
          }
          if (isRateLimitError(error)) {
            await handleRateLimit(error, onProgress, 'forks', forks.length);
            // Don't break, we'll retry this batch
            gotEmptyPage = true;
            break;
          }
          console.error(`Error fetching forks page:`, error.message);
          continue;
        }

        const { data, headers, page } = result.value;

        if (data.length === 0) {
          gotEmptyPage = true;
          break;
        }

        for (const f of data) {
          forks.push({
            owner: f.owner.login,
            createdAt: f.created_at
          });
        }

        lastPage = page;

        // Track rate limit
        const remaining = parseInt(headers['x-ratelimit-remaining'] || '100');
        if (remaining < lowestRateLimit) {
          lowestRateLimit = remaining;
          rateLimitHeaders = headers;
        }

        if (data.length < perPage) {
          gotPartialPage = true;
        }
      }

      onProgress?.({ type: 'forks', fetched: forks.length + ((startPage - 1) * perPage), partial: false, page: lastPage });

      // Save progress incrementally
      if (onSave && forks.length - lastSaveCount >= SAVE_INTERVAL) {
        console.log(`Saving forks progress: ${forks.length} items, page: ${lastPage}`);
        await onSave({ type: 'forks', data: forks.slice(lastSaveCount), page: lastPage, hasMore: true });
        lastSaveCount = forks.length;
      }

      if (gotEmptyPage || gotPartialPage || hitPaginationLimit) {
        hasMore = false;
      } else {
        currentPage += PARALLEL_REQUESTS;
        // Check rate limit before next batch
        if (rateLimitHeaders) {
          await checkRateLimit(rateLimitHeaders, onProgress, 'forks', forks.length);
        }
      }
    } catch (error) {
      console.error(`Error in parallel forks fetch:`, error.message);
      if (isPaginationLimitError(error)) {
        hitPaginationLimit = true;
      }
      hasMore = false;
    }
  }

  // Final save of any remaining data
  if (onSave && forks.length > lastSaveCount) {
    console.log(`Final save for forks: ${forks.length - lastSaveCount} items`);
    await onSave({ type: 'forks', data: forks.slice(lastSaveCount), page: lastPage, hasMore: false });
  }

  return {
    forks,
    hitPaginationLimit,
    lastPage,
    startPage
  };
}

export async function fetchAllIssues(octokit, owner, repo, onProgress, sinceDate = null, onSave = null) {
  const issues = [];
  let currentPage = 1;
  const perPage = 100;
  let hitPaginationLimit = false;
  let lastDate = null;
  const SAVE_INTERVAL = 1000;
  let lastSaveCount = 0;
  let hasMore = true;

  console.log(`Fetching issues${sinceDate ? ` since ${sinceDate}` : ' (full fetch)'} with ${PARALLEL_REQUESTS}x parallelism...`);

  while (hasMore) {
    const fetchPage = async (page) => {
      const params = {
        owner,
        repo,
        state: 'all',
        per_page: perPage,
        page,
        sort: 'created',
        direction: 'asc'
      };
      if (sinceDate) {
        params.since = new Date(sinceDate).toISOString();
      }
      const { data, headers } = await octokit.issues.listForRepo(params);
      return { data, headers, page };
    };

    try {
      const results = await fetchPagesInParallel(fetchPage, currentPage, PARALLEL_REQUESTS);

      let gotEmptyPage = false;
      let gotPartialPage = false;
      let lowestRateLimit = Infinity;
      let rateLimitHeaders = null;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          const error = result.reason;
          if (isPaginationLimitError(error)) {
            hitPaginationLimit = true;
            gotEmptyPage = true;
            break;
          }
          if (isRateLimitError(error)) {
            await handleRateLimit(error, onProgress, 'issues', issues.length);
            gotEmptyPage = true;
            break;
          }
          continue;
        }

        const { data, headers } = result.value;

        if (data.length === 0) {
          gotEmptyPage = true;
          break;
        }

        const realIssues = data.filter(i => !i.pull_request);
        for (const i of realIssues) {
          issues.push({
            number: i.number,
            state: i.state,
            createdAt: i.created_at,
            closedAt: i.closed_at
          });
          const issueDate = i.created_at.split('T')[0];
          if (!lastDate || issueDate > lastDate) {
            lastDate = issueDate;
          }
        }

        const remaining = parseInt(headers['x-ratelimit-remaining'] || '100');
        if (remaining < lowestRateLimit) {
          lowestRateLimit = remaining;
          rateLimitHeaders = headers;
        }

        if (data.length < perPage) {
          gotPartialPage = true;
        }
      }

      onProgress?.({ type: 'issues', fetched: issues.length, partial: false });

      if (onSave && issues.length - lastSaveCount >= SAVE_INTERVAL) {
        console.log(`Saving issues progress: ${issues.length} items, lastDate: ${lastDate}`);
        await onSave({ type: 'issues', data: issues.slice(lastSaveCount), lastDate, hasMore: true });
        lastSaveCount = issues.length;
      }

      if (gotEmptyPage || gotPartialPage || hitPaginationLimit) {
        hasMore = false;
      } else {
        currentPage += PARALLEL_REQUESTS;
        if (rateLimitHeaders) {
          await checkRateLimit(rateLimitHeaders, onProgress, 'issues', issues.length);
        }
      }
    } catch (error) {
      console.error(`Error in parallel issues fetch:`, error.message);
      if (isPaginationLimitError(error)) {
        hitPaginationLimit = true;
      }
      hasMore = false;
    }
  }

  // Final save of any remaining data
  if (onSave && issues.length > lastSaveCount) {
    console.log(`Final save for issues: ${issues.length - lastSaveCount} items`);
    await onSave({ type: 'issues', data: issues.slice(lastSaveCount), lastDate, hasMore: false });
  }

  return {
    issues,
    hitPaginationLimit,
    lastDate
  };
}

export async function fetchAllPullRequests(octokit, owner, repo, onProgress, startPage = 1, onSave = null) {
  const prs = [];
  let currentPage = startPage;
  const perPage = 100;
  let hitPaginationLimit = false;
  let lastPage = currentPage;
  const SAVE_INTERVAL = 500;
  let lastSaveCount = 0;
  let hasMore = true;

  console.log(`Fetching PRs${startPage > 1 ? ` (resuming from page ${startPage})` : ' (full fetch)'} with ${PARALLEL_REQUESTS}x parallelism...`);

  while (hasMore) {
    const fetchPage = async (page) => {
      const { data, headers } = await octokit.pulls.list({
        owner,
        repo,
        state: 'all',
        per_page: perPage,
        page,
        sort: 'created',
        direction: 'asc'
      });
      return { data, headers, page };
    };

    try {
      const results = await fetchPagesInParallel(fetchPage, currentPage, PARALLEL_REQUESTS);

      let gotEmptyPage = false;
      let gotPartialPage = false;
      let lowestRateLimit = Infinity;
      let rateLimitHeaders = null;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          const error = result.reason;
          if (isPaginationLimitError(error)) {
            hitPaginationLimit = true;
            gotEmptyPage = true;
            break;
          }
          if (isRateLimitError(error)) {
            await handleRateLimit(error, onProgress, 'prs', prs.length);
            gotEmptyPage = true;
            break;
          }
          continue;
        }

        const { data, headers, page } = result.value;

        if (data.length === 0) {
          gotEmptyPage = true;
          break;
        }

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

        const remaining = parseInt(headers['x-ratelimit-remaining'] || '100');
        if (remaining < lowestRateLimit) {
          lowestRateLimit = remaining;
          rateLimitHeaders = headers;
        }

        if (data.length < perPage) {
          gotPartialPage = true;
        }
      }

      onProgress?.({ type: 'prs', fetched: prs.length + ((startPage - 1) * perPage), partial: false, page: lastPage });

      if (onSave && prs.length - lastSaveCount >= SAVE_INTERVAL) {
        console.log(`Saving PRs progress: ${prs.length} items, page: ${lastPage}`);
        await onSave({ type: 'prs', data: prs.slice(lastSaveCount), page: lastPage, hasMore: true });
        lastSaveCount = prs.length;
      }

      if (gotEmptyPage || gotPartialPage || hitPaginationLimit) {
        hasMore = false;
      } else {
        currentPage += PARALLEL_REQUESTS;
        if (rateLimitHeaders) {
          await checkRateLimit(rateLimitHeaders, onProgress, 'prs', prs.length);
        }
      }
    } catch (error) {
      console.error(`Error in parallel PRs fetch:`, error.message);
      if (isPaginationLimitError(error)) {
        hitPaginationLimit = true;
      }
      hasMore = false;
    }
  }

  // Final save of any remaining data
  if (onSave && prs.length > lastSaveCount) {
    console.log(`Final save for PRs: ${prs.length - lastSaveCount} items`);
    await onSave({ type: 'prs', data: prs.slice(lastSaveCount), page: lastPage, hasMore: false });
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

export async function fetchContributorCommits(octokit, owner, repo, onProgress, sinceDate = null, onSave = null) {
  const commits = [];
  let currentPage = 1;
  const perPage = 100;
  let hitPaginationLimit = false;
  let lastDate = null;
  const SAVE_INTERVAL = 500;
  let lastSaveCount = 0;
  let hasMore = true;

  console.log(`Fetching commits${sinceDate ? ` since ${sinceDate}` : ' (full fetch)'} with ${PARALLEL_REQUESTS}x parallelism...`);

  while (hasMore) {
    const fetchPage = async (page) => {
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
      return { data, headers, page };
    };

    try {
      const results = await fetchPagesInParallel(fetchPage, currentPage, PARALLEL_REQUESTS);

      let gotEmptyPage = false;
      let gotPartialPage = false;
      let lowestRateLimit = Infinity;
      let rateLimitHeaders = null;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          const error = result.reason;
          if (isPaginationLimitError(error)) {
            hitPaginationLimit = true;
            gotEmptyPage = true;
            break;
          }
          if (isRateLimitError(error)) {
            await handleRateLimit(error, onProgress, 'commits', commits.length);
            gotEmptyPage = true;
            break;
          }
          continue;
        }

        const { data, headers } = result.value;

        if (data.length === 0) {
          gotEmptyPage = true;
          break;
        }

        for (const c of data) {
          commits.push({
            sha: c.sha,
            author: c.author?.login || c.commit?.author?.name,
            date: c.commit.author.date
          });
          const commitDate = c.commit.author.date.split('T')[0];
          if (!lastDate || commitDate > lastDate) {
            lastDate = commitDate;
          }
        }

        const remaining = parseInt(headers['x-ratelimit-remaining'] || '100');
        if (remaining < lowestRateLimit) {
          lowestRateLimit = remaining;
          rateLimitHeaders = headers;
        }

        if (data.length < perPage) {
          gotPartialPage = true;
        }
      }

      onProgress?.({ type: 'commits', fetched: commits.length, partial: false });

      if (onSave && commits.length - lastSaveCount >= SAVE_INTERVAL) {
        console.log(`Saving commits progress: ${commits.length} items, lastDate: ${lastDate}`);
        await onSave({ type: 'commits', data: commits.slice(lastSaveCount), lastDate, hasMore: true });
        lastSaveCount = commits.length;
      }

      if (gotEmptyPage || gotPartialPage || hitPaginationLimit) {
        hasMore = false;
      } else {
        currentPage += PARALLEL_REQUESTS;
        if (rateLimitHeaders) {
          await checkRateLimit(rateLimitHeaders, onProgress, 'commits', commits.length);
        }
      }
    } catch (error) {
      console.error(`Error in parallel commits fetch:`, error.message);
      if (isPaginationLimitError(error)) {
        hitPaginationLimit = true;
      }
      hasMore = false;
    }
  }

  // Final save of any remaining data
  if (onSave && commits.length > lastSaveCount) {
    console.log(`Final save for commits: ${commits.length - lastSaveCount} items`);
    await onSave({ type: 'commits', data: commits.slice(lastSaveCount), lastDate, hasMore: false });
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
