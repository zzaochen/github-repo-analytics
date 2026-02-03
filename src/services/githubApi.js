import { Octokit } from '@octokit/rest';

export function createGitHubClient(token) {
  return new Octokit({ auth: token });
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

export async function fetchAllStargazers(octokit, owner, repo, onProgress) {
  const stargazers = [];
  let page = 1;
  const perPage = 100;

  while (true) {
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

      stargazers.push(...data.map(s => ({
        user: s.user.login,
        starredAt: s.starred_at
      })));

      onProgress?.({ type: 'stars', fetched: stargazers.length });

      if (data.length < perPage) break;
      page++;

      // Rate limit handling
      await checkRateLimit(headers);
    } catch (error) {
      if (error.status === 403) {
        console.warn('Rate limited, waiting...');
        await sleep(60000);
        continue;
      }
      throw error;
    }
  }

  return stargazers;
}

export async function fetchAllForks(octokit, owner, repo, onProgress) {
  const forks = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    try {
      const { data, headers } = await octokit.repos.listForks({
        owner,
        repo,
        per_page: perPage,
        page,
        sort: 'oldest'
      });

      if (data.length === 0) break;

      forks.push(...data.map(f => ({
        owner: f.owner.login,
        createdAt: f.created_at
      })));

      onProgress?.({ type: 'forks', fetched: forks.length });

      if (data.length < perPage) break;
      page++;

      await checkRateLimit(headers);
    } catch (error) {
      if (error.status === 403) {
        await sleep(60000);
        continue;
      }
      throw error;
    }
  }

  return forks;
}

export async function fetchAllIssues(octokit, owner, repo, onProgress) {
  const issues = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    try {
      const { data, headers } = await octokit.issues.listForRepo({
        owner,
        repo,
        state: 'all',
        per_page: perPage,
        page,
        sort: 'created',
        direction: 'asc'
      });

      if (data.length === 0) break;

      // Filter out pull requests (GitHub API includes PRs in issues)
      const realIssues = data.filter(i => !i.pull_request);

      issues.push(...realIssues.map(i => ({
        number: i.number,
        state: i.state,
        createdAt: i.created_at,
        closedAt: i.closed_at
      })));

      onProgress?.({ type: 'issues', fetched: issues.length });

      if (data.length < perPage) break;
      page++;

      await checkRateLimit(headers);
    } catch (error) {
      if (error.status === 403) {
        await sleep(60000);
        continue;
      }
      throw error;
    }
  }

  return issues;
}

export async function fetchAllPullRequests(octokit, owner, repo, onProgress) {
  const prs = [];
  let page = 1;
  const perPage = 100;

  while (true) {
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

      prs.push(...data.map(pr => ({
        number: pr.number,
        state: pr.state,
        createdAt: pr.created_at,
        closedAt: pr.closed_at,
        mergedAt: pr.merged_at
      })));

      onProgress?.({ type: 'prs', fetched: prs.length });

      if (data.length < perPage) break;
      page++;

      await checkRateLimit(headers);
    } catch (error) {
      if (error.status === 403) {
        await sleep(60000);
        continue;
      }
      throw error;
    }
  }

  return prs;
}

export async function fetchAllContributors(octokit, owner, repo, onProgress) {
  const contributors = [];
  let page = 1;
  const perPage = 100;

  while (true) {
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

      onProgress?.({ type: 'contributors', fetched: contributors.length });

      if (data.length < perPage) break;
      page++;

      await checkRateLimit(headers);
    } catch (error) {
      if (error.status === 403) {
        await sleep(60000);
        continue;
      }
      throw error;
    }
  }

  return contributors;
}

export async function fetchContributorCommits(octokit, owner, repo, onProgress) {
  // Get commit activity to understand contributor growth over time
  const commits = [];
  let page = 1;
  const perPage = 100;

  // Only fetch first 1000 commits to avoid excessive API calls
  const maxCommits = 1000;

  while (commits.length < maxCommits) {
    try {
      const { data, headers } = await octokit.repos.listCommits({
        owner,
        repo,
        per_page: perPage,
        page
      });

      if (data.length === 0) break;

      commits.push(...data.map(c => ({
        sha: c.sha,
        author: c.author?.login || c.commit?.author?.name,
        date: c.commit.author.date
      })));

      onProgress?.({ type: 'commits', fetched: commits.length });

      if (data.length < perPage) break;
      page++;

      await checkRateLimit(headers);
    } catch (error) {
      if (error.status === 403) {
        await sleep(60000);
        continue;
      }
      throw error;
    }
  }

  return commits;
}

async function checkRateLimit(headers) {
  const remaining = parseInt(headers['x-ratelimit-remaining'] || '100');
  if (remaining < 10) {
    const resetTime = parseInt(headers['x-ratelimit-reset'] || '0') * 1000;
    const waitTime = Math.max(0, resetTime - Date.now()) + 1000;
    console.log(`Rate limit low (${remaining}), waiting ${waitTime / 1000}s...`);
    await sleep(Math.min(waitTime, 60000));
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
