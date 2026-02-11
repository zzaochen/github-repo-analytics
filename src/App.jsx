import { useState, useEffect } from 'react';
import RepoInput from './components/RepoInput';
import LoadingProgress from './components/LoadingProgress';
import Dashboard from './components/Dashboard';
import CachedRepos from './components/CachedRepos';
import TokenSettings from './components/TokenSettings';
import {
  createGitHubClient,
  fetchRepoInfo,
  fetchAllStargazers,
  fetchAllStargazersGraphQL,
  fetchAllForks,
  fetchAllIssues,
  fetchAllPullRequests,
  fetchContributorCommits
} from './services/githubApi';
import {
  getRepoFromCache,
  saveRepoToCache,
  transformCachedMetrics,
  mergeDailyMetrics,
  deleteRepoFromCache
} from './services/supabase';
import { aggregateToDaily } from './utils/dataAggregator';

function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [repoInfo, setRepoInfo] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [progress, setProgress] = useState({});
  const [dataSource, setDataSource] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [cacheKey, setCacheKey] = useState(0);
  const [starsPaginationLimited, setStarsPaginationLimited] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [token, setToken] = useState('');
  const [saveToken, setSaveToken] = useState(true);

  const TOKEN_KEY = 'github_analytics_token';

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      setToken(savedToken);
    } else if (import.meta.env.VITE_GITHUB_TOKEN) {
      setToken(import.meta.env.VITE_GITHUB_TOKEN);
    }
  }, []);

  useEffect(() => {
    if (saveToken && token) {
      localStorage.setItem(TOKEN_KEY, token);
    }
  }, [token, saveToken]);

  // Load from cache only (no fetching)
  const loadFromCache = async (owner, repo, token) => {
    setIsLoading(true);
    setError(null);
    setProgress({ status: 'Loading from cache...' });

    try {
      const cached = await getRepoFromCache(owner, repo);
      console.log('Cache result:', cached);

      if (cached && cached.metrics.length > 0) {
        const octokit = createGitHubClient(token);
        const info = await fetchRepoInfo(octokit, owner, repo);
        setRepoInfo(info);
        const transformedData = transformCachedMetrics(cached.metrics);
        console.log('Transformed data sample (last 3 days):', JSON.stringify(transformedData.slice(-3), null, 2));
        console.log('Raw cached metrics sample (last 3):', JSON.stringify(cached.metrics.slice(-3), null, 2));
        setDailyData(transformedData);
        setDataSource('cache');
        setLastFetched(cached.repository.last_fetched);
        // Check if any metric is pagination limited
        const anyLimited = cached.fetchState?.stars?.limited ||
                          cached.fetchState?.forks?.limited ||
                          cached.fetchState?.prs?.limited;
        setStarsPaginationLimited(anyLimited || false);
      } else {
        console.log('No cache found, fetching from GitHub...');
        // No cache, need to fetch
        await fetchData(owner, repo, token, null); // null = fresh fetch, no resume state
      }
    } catch (err) {
      console.error('Error loading from cache:', err);
      setError(err.message || 'Failed to load from cache');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch data with full pagination resume support for all metrics
  const fetchData = async (owner, repo, token, resumeState = null) => {
    const isResuming = !!resumeState;

    try {
      if (isResuming) {
        setProgress({ status: 'Resuming data fetch...' });
        console.log('Resuming fetch with state:', resumeState);
      } else {
        setProgress({ status: 'Fetching all historical data...' });
        console.log('Full fetch');
      }

      const octokit = createGitHubClient(token);
      const info = await fetchRepoInfo(octokit, owner, repo);
      setRepoInfo(info);

      const updateProgress = (update) => {
        setProgress(prev => ({
          ...prev,
          [update.type]: {
            fetched: update.fetched,
            partial: update.partial,
            rateLimit: update.rateLimit,
            secondsRemaining: update.secondsRemaining,
            page: update.page
          }
        }));
      };

      // Fetch stars using GraphQL (cursor-based pagination, no 1000-page limit)
      const starsCursor = resumeState?.stars?.cursor || null;
      setProgress(prev => ({ ...prev, status: starsCursor ? 'Resuming stars fetch...' : 'Fetching stars (GraphQL)...' }));
      const starsResult = await fetchAllStargazersGraphQL(token, owner, repo, updateProgress, starsCursor);
      console.log(`Stars fetch: ${starsResult.stargazers.length} stars, hasMore: ${starsResult.hasMorePages}, hitRateLimit: ${starsResult.hitRateLimit}`);
      setProgress(prev => ({ ...prev, stars: { ...prev.stars, done: true, partial: starsResult.hasMorePages || starsResult.hitRateLimit } }));

      // Fetch forks (with resume support via page number)
      const forksStartPage = resumeState?.forks?.lastPage ? resumeState.forks.lastPage + 1 : 1;
      setProgress(prev => ({ ...prev, status: forksStartPage > 1 ? `Resuming forks from page ${forksStartPage}...` : 'Fetching forks...' }));
      const forksResult = await fetchAllForks(octokit, owner, repo, updateProgress, forksStartPage);
      console.log(`Forks fetch: ${forksResult.forks.length} forks, hitLimit: ${forksResult.hitPaginationLimit}, lastPage: ${forksResult.lastPage}`);
      setProgress(prev => ({ ...prev, forks: { ...prev.forks, done: true, partial: forksResult.hitPaginationLimit } }));

      // Fetch issues (with resume support via since date)
      const issuesSinceDate = resumeState?.issues?.lastDate || null;
      setProgress(prev => ({ ...prev, status: issuesSinceDate ? `Fetching issues since ${issuesSinceDate}...` : 'Fetching issues...' }));
      const issuesResult = await fetchAllIssues(octokit, owner, repo, updateProgress, issuesSinceDate);
      console.log(`Issues fetch: ${issuesResult.issues.length} issues, hitLimit: ${issuesResult.hitPaginationLimit}, lastDate: ${issuesResult.lastDate}`);
      setProgress(prev => ({ ...prev, issues: { ...prev.issues, done: true, partial: issuesResult.hitPaginationLimit } }));

      // Fetch PRs (with resume support via page number)
      const prsStartPage = resumeState?.prs?.lastPage ? resumeState.prs.lastPage + 1 : 1;
      setProgress(prev => ({ ...prev, status: prsStartPage > 1 ? `Resuming PRs from page ${prsStartPage}...` : 'Fetching pull requests...' }));
      const prsResult = await fetchAllPullRequests(octokit, owner, repo, updateProgress, prsStartPage);
      console.log(`PRs fetch: ${prsResult.prs.length} PRs, hitLimit: ${prsResult.hitPaginationLimit}, lastPage: ${prsResult.lastPage}`);
      setProgress(prev => ({ ...prev, prs: { ...prev.prs, done: true, partial: prsResult.hitPaginationLimit } }));

      // Fetch commits (with resume support via since date)
      const commitsSinceDate = resumeState?.commits?.lastDate || null;
      setProgress(prev => ({ ...prev, status: commitsSinceDate ? `Fetching commits since ${commitsSinceDate}...` : 'Fetching commits...' }));
      const commitsResult = await fetchContributorCommits(octokit, owner, repo, updateProgress, commitsSinceDate);
      console.log(`Commits fetch: ${commitsResult.commits.length} commits, hitLimit: ${commitsResult.hitPaginationLimit}, lastDate: ${commitsResult.lastDate}`);
      setProgress(prev => ({ ...prev, commits: { ...prev.commits, done: true, partial: commitsResult.hitPaginationLimit } }));

      setProgress({ status: 'Processing data...' });
      const newAggregated = aggregateToDaily(
        info,
        starsResult.stargazers,
        forksResult.forks,
        issuesResult.issues,
        prsResult.prs,
        commitsResult.commits
      );

      let finalData;
      const cached = await getRepoFromCache(owner, repo);

      if (isResuming && cached && cached.metrics.length > 0) {
        setProgress({ status: 'Merging with cached data...' });
        const existingData = transformCachedMetrics(cached.metrics);
        finalData = mergeDailyMetrics(existingData, newAggregated);
        console.log(`Merged ${existingData.length} cached days with ${newAggregated.length} new days = ${finalData.length} total days`);
      } else {
        finalData = newAggregated;
      }

      setDailyData(finalData);

      setProgress({ status: 'Saving to cache...' });

      // Track fetch state for all metrics
      const fetchState = {
        stars: {
          lastPage: null, // Not used for GraphQL
          limited: starsResult.hasMorePages || starsResult.hitRateLimit,
          cursor: starsResult.hasMorePages || starsResult.hitRateLimit ? starsResult.lastCursor : null
        },
        forks: {
          lastPage: forksResult.hitPaginationLimit ? forksResult.lastPage : null,
          limited: forksResult.hitPaginationLimit
        },
        prs: {
          lastPage: prsResult.hitPaginationLimit ? prsResult.lastPage : null,
          limited: prsResult.hitPaginationLimit
        },
        issues: {
          lastDate: issuesResult.lastDate
        },
        commits: {
          lastDate: commitsResult.lastDate
        }
      };

      // Check if any metric is still limited
      const anyLimited = starsResult.hitPaginationLimit || forksResult.hitPaginationLimit ||
                         prsResult.hitPaginationLimit || issuesResult.hitPaginationLimit ||
                         commitsResult.hitPaginationLimit;

      await saveRepoToCache(owner, repo, finalData, isResuming, fetchState);

      setDataSource(isResuming ? 'resumed' : 'github');
      setLastFetched(new Date().toISOString());
      setStarsPaginationLimited(anyLimited);
      setCacheKey(k => k + 1);

      if (anyLimited) {
        console.log('Some metrics hit pagination limits. Click "Continue Fetching" to resume.');
      }

    } catch (err) {
      console.error('Error fetching repo:', err);
      setError(err.message || 'Failed to fetch repository data');
    }
  };

  // Handle form submission (new repo or re-fetch)
  const handleSubmit = async (owner, repo, token) => {
    setIsLoading(true);
    setError(null);
    setProgress({});
    setDataSource(null);

    try {
      // Check if we have cached data
      setProgress({ status: 'Checking cache...' });
      const cached = await getRepoFromCache(owner, repo);
      console.log('handleSubmit - Cache result:', cached);

      if (cached && cached.metrics.length > 0) {
        // Load from cache
        const octokit = createGitHubClient(token);
        const info = await fetchRepoInfo(octokit, owner, repo);
        setRepoInfo(info);
        const transformedData = transformCachedMetrics(cached.metrics);
        console.log('handleSubmit - Transformed data sample (last 3 days):', JSON.stringify(transformedData.slice(-3), null, 2));
        console.log('handleSubmit - Raw cached metrics sample (last 3):', JSON.stringify(cached.metrics.slice(-3), null, 2));
        setDailyData(transformedData);
        setDataSource('cache');
        setLastFetched(cached.repository.last_fetched);
        // Check if any metric is pagination limited
        const anyLimited = cached.fetchState?.stars?.limited ||
                          cached.fetchState?.forks?.limited ||
                          cached.fetchState?.prs?.limited;
        setStarsPaginationLimited(anyLimited || false);
      } else {
        // No cache, do full fetch
        console.log('handleSubmit - No cache, doing full fetch');
        await fetchData(owner, repo, token, null); // null = fresh fetch, no resume state
      }
    } catch (err) {
      console.error('Error:', err);
      setError(err.message || 'Failed to load repository data');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle "Update to Today" button - fetch new data since last cached date
  const handleUpdateToToday = async () => {
    if (!repoInfo) return;

    const [owner, repo] = repoInfo.name.split('/');
    const token = localStorage.getItem('github_analytics_token');
    if (!token) return;

    setIsLoading(true);
    setError(null);
    setProgress({});

    try {
      const cached = await getRepoFromCache(owner, repo);
      // Use the last date as the "since" date for issues/commits
      const resumeState = {
        issues: { lastDate: cached?.lastDate },
        commits: { lastDate: cached?.lastDate }
      };

      await fetchData(owner, repo, token, resumeState);
    } catch (err) {
      console.error('Error updating:', err);
      setError(err.message || 'Failed to update repository data');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle "Continue Fetching" button - resume from where pagination limits were hit
  const handleContinueFetching = async () => {
    if (!repoInfo) return;

    const [owner, repo] = repoInfo.name.split('/');
    const token = localStorage.getItem('github_analytics_token');
    if (!token) return;

    setIsLoading(true);
    setError(null);
    setProgress({});

    try {
      const cached = await getRepoFromCache(owner, repo);
      console.log('Continuing fetch with state:', cached?.fetchState);

      await fetchData(owner, repo, token, cached?.fetchState);
    } catch (err) {
      console.error('Error continuing fetch:', err);
      setError(err.message || 'Failed to continue fetching');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle clicking a cached repo
  const handleCachedRepoSelect = (owner, repo) => {
    const token = localStorage.getItem('github_analytics_token');
    if (token) {
      loadFromCache(owner, repo, token);
    }
  };

  // Handle updating all cached repos to today (full update with pagination resume)
  const handleUpdateAll = async (repos) => {
    const token = localStorage.getItem('github_analytics_token');
    if (!token) {
      setError('No GitHub token found. Please enter your token first.');
      return;
    }

    if (!confirm(`Update all ${repos.length} cached repositories to today? This may take a while.`)) {
      return;
    }

    setIsLoading(true);
    setError(null);

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      setProgress({ status: `Updating ${repo.owner}/${repo.repo} (${i + 1}/${repos.length})...` });

      try {
        const cached = await getRepoFromCache(repo.owner, repo.repo);
        const resumeState = cached?.fetchState || null;

        // If there's incomplete data (pagination limited), use resume state
        // Otherwise, just fetch new data since last date
        const hasIncompleteData = resumeState?.stars?.limited ||
                                   resumeState?.forks?.limited ||
                                   resumeState?.prs?.limited;

        if (hasIncompleteData) {
          await fetchData(repo.owner, repo.repo, token, resumeState);
        } else {
          // Just fetch new data since last cached date
          const updateState = {
            issues: { lastDate: cached?.lastDate },
            commits: { lastDate: cached?.lastDate }
          };
          await fetchData(repo.owner, repo.repo, token, updateState);
        }
      } catch (err) {
        console.error(`Error updating ${repo.owner}/${repo.repo}:`, err);
        // Continue with next repo even if one fails
      }
    }

    setProgress({ status: 'All repositories updated!' });
    setCacheKey(k => k + 1);
    setIsLoading(false);
  };

  // Handle quick update - only fetch data since last cached date (no pagination resume)
  const handleQuickUpdateAll = async (repos) => {
    const token = localStorage.getItem('github_analytics_token');
    if (!token) {
      setError('No GitHub token found. Please enter your token first.');
      return;
    }

    setIsLoading(true);
    setError(null);

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      setProgress({ status: `Quick update ${repo.owner}/${repo.repo} (${i + 1}/${repos.length})...` });

      try {
        const cached = await getRepoFromCache(repo.owner, repo.repo);
        if (!cached?.lastDate) {
          console.log(`Skipping ${repo.owner}/${repo.repo} - no cached data`);
          continue;
        }

        // Only fetch new data since last cached date (no pagination resume)
        const quickUpdateState = {
          stars: { cursor: 'SKIP' }, // Special flag to skip stars (most expensive)
          issues: { lastDate: cached.lastDate },
          commits: { lastDate: cached.lastDate }
        };

        await fetchDataQuick(repo.owner, repo.repo, token, cached.lastDate);
      } catch (err) {
        console.error(`Error quick updating ${repo.owner}/${repo.repo}:`, err);
        // Continue with next repo even if one fails
      }
    }

    setProgress({ status: 'Quick update complete!' });
    setCacheKey(k => k + 1);
    setIsLoading(false);
  };

  // Quick fetch - only gets data since a specific date, skips expensive operations
  const fetchDataQuick = async (owner, repo, token, sinceDate) => {
    try {
      const octokit = createGitHubClient(token);
      const info = await fetchRepoInfo(octokit, owner, repo);

      const updateProgress = (update) => {
        setProgress(prev => ({
          ...prev,
          [update.type]: { fetched: update.fetched }
        }));
      };

      // Only fetch issues and commits (they support 'since' parameter and are fast)
      setProgress(prev => ({ ...prev, status: `Fetching issues since ${sinceDate}...` }));
      const issuesResult = await fetchAllIssues(octokit, owner, repo, updateProgress, sinceDate);

      setProgress(prev => ({ ...prev, status: `Fetching commits since ${sinceDate}...` }));
      const commitsResult = await fetchContributorCommits(octokit, owner, repo, updateProgress, sinceDate);

      // Create minimal aggregated data for new dates only
      setProgress({ status: 'Processing new data...' });
      const newAggregated = aggregateToDaily(
        info,
        [], // No new stars in quick update
        [], // No new forks in quick update
        issuesResult.issues,
        [], // No new PRs in quick update
        commitsResult.commits
      );

      // Merge with existing cached data
      const cached = await getRepoFromCache(owner, repo);
      if (cached && cached.metrics.length > 0) {
        const existingData = transformCachedMetrics(cached.metrics);
        const finalData = mergeDailyMetrics(existingData, newAggregated);

        setProgress({ status: 'Saving...' });
        await saveRepoToCache(owner, repo, finalData, true, null);
      }

    } catch (err) {
      console.error(`Error in quick fetch for ${owner}/${repo}:`, err);
      throw err;
    }
  };

  // Handle deleting a repo from cache and re-fetching fresh
  const handleDeleteAndRefetch = async () => {
    if (!repoInfo) return;

    const [owner, repo] = repoInfo.name.split('/');
    const token = localStorage.getItem('github_analytics_token');
    if (!token) return;

    if (!confirm(`Delete cached data for ${owner}/${repo} and fetch fresh?`)) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgress({ status: 'Deleting cached data...' });

    try {
      await deleteRepoFromCache(owner, repo);
      setCacheKey(k => k + 1);

      // Now fetch fresh
      await fetchData(owner, repo, token, null);
    } catch (err) {
      console.error('Error:', err);
      setError(err.message || 'Failed to delete and re-fetch');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-80' : 'w-0'
        } transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0`}
      >
        <div className={`w-80 h-screen bg-white border-r border-gray-200 p-4 fixed flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                <path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM16 3a1 1 0 011 1v7.268a2 2 0 010 3.464V16a1 1 0 11-2 0v-1.268a2 2 0 010-3.464V4a1 1 0 011-1z" />
              </svg>
              <h2 className="text-lg font-semibold text-gray-800">Control</h2>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              title="Hide sidebar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <RepoInput onSubmit={handleSubmit} isLoading={isLoading} token={token} />

            <CachedRepos
              key={cacheKey}
              onSelect={handleCachedRepoSelect}
              onUpdateAll={handleUpdateAll}
              onQuickUpdateAll={handleQuickUpdateAll}
              isLoading={isLoading}
            />
          </div>

          <TokenSettings
            token={token}
            setToken={setToken}
            saveToken={saveToken}
            setSaveToken={setSaveToken}
          />
        </div>
      </div>

      {/* Hamburger menu - fixed top left when sidebar closed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 left-4 p-2 bg-white hover:bg-gray-100 rounded-lg shadow-md transition-colors z-50"
          title="Show sidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">GitHub Repository Analytics</h1>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 rounded-lg p-4 mb-6">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {isLoading && <LoadingProgress progress={progress} />}

          {!isLoading && dailyData && repoInfo && (
            <Dashboard
              repoInfo={repoInfo}
              dailyData={dailyData}
              dataSource={dataSource}
              lastFetched={lastFetched}
              onForceRefresh={handleUpdateToToday}
              paginationLimited={starsPaginationLimited}
              onContinueFetching={handleContinueFetching}
              onDeleteAndRefetch={handleDeleteAndRefetch}
            />
          )}

          {!isLoading && !dailyData && (
            <div className="text-center py-16 text-gray-500">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-lg">Enter a repository to analyze</p>
              <p className="text-sm mt-1">Or select a cached repository from the sidebar</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
