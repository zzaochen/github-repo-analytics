import { useState, useEffect } from 'react';
import LoadingProgress from './components/LoadingProgress';
import Dashboard from './components/Dashboard';
import CachedRepos from './components/CachedRepos';
import TokenSettings from './components/TokenSettings';
import CompareView from './components/CompareView';
import TrendingView from './components/TrendingView';
import BatchFetch from './components/BatchFetch';
import RateLimitStatus from './components/RateLimitStatus';
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
  deleteRepoFromCache,
  backfillAllMonthlyMetrics,
  getCachedRepos,
  updateFetchProgress,
  getOrCreateRepo
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
  const [activeView, setActiveView] = useState('repoData');
  const [token, setToken] = useState('');
  const [saveToken, setSaveToken] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState('');

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
  // silent: true skips UI updates (for batch operations)
  const fetchData = async (owner, repo, token, resumeState = null, silent = false) => {
    const isResuming = !!resumeState;

    try {
      if (!silent) {
        if (isResuming) {
          setProgress({ status: 'Resuming data fetch...' });
        } else {
          setProgress({ status: 'Fetching all historical data...' });
        }
      }
      console.log(isResuming ? 'Resuming fetch with state:' : 'Full fetch', resumeState);

      // Mark fetch as in progress so we can resume if interrupted
      await updateFetchProgress(owner, repo, { inProgress: true });

      const octokit = createGitHubClient(token);
      const info = await fetchRepoInfo(octokit, owner, repo);
      if (!silent) {
        setRepoInfo(info);
      }

      const updateProgress = silent ? () => {} : (update) => {
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

      // Track current fetch state for incremental saving
      const currentFetchState = {
        stars: { cursor: resumeState?.stars?.cursor || null, limited: false },
        forks: { lastPage: resumeState?.forks?.lastPage || 0, limited: false },
        issues: { lastDate: resumeState?.issues?.lastDate || null },
        prs: { lastPage: resumeState?.prs?.lastPage || 0, limited: false },
        commits: { lastDate: resumeState?.commits?.lastDate || null }
      };

      // Create onSave callback for incremental saving
      const createOnSave = () => async (saveData) => {
        console.log(`Incremental save: ${saveData.type}, ${saveData.data?.length || 0} items`);

        // Update fetch state based on save data
        if (saveData.type === 'stars' && saveData.cursor) {
          currentFetchState.stars.cursor = saveData.cursor;
          currentFetchState.stars.limited = saveData.hasMore;
        } else if (saveData.type === 'forks' && saveData.page) {
          currentFetchState.forks.lastPage = saveData.page;
          currentFetchState.forks.limited = saveData.hasMore;
        } else if (saveData.type === 'issues' && saveData.lastDate) {
          currentFetchState.issues.lastDate = saveData.lastDate;
        } else if (saveData.type === 'prs' && saveData.page) {
          currentFetchState.prs.lastPage = saveData.page;
          currentFetchState.prs.limited = saveData.hasMore;
        } else if (saveData.type === 'commits' && saveData.lastDate) {
          currentFetchState.commits.lastDate = saveData.lastDate;
        }

        // Save fetch progress to database
        await updateFetchProgress(owner, repo, {
          ...currentFetchState,
          inProgress: true
        });
      };

      const onSave = createOnSave();

      // Prepare resume state parameters
      const starsCursor = resumeState?.stars?.cursor || null;
      const forksStartPage = resumeState?.forks?.lastPage ? resumeState.forks.lastPage + 1 : 1;
      const issuesSinceDate = resumeState?.issues?.lastDate || null;
      const prsStartPage = resumeState?.prs?.lastPage ? resumeState.prs.lastPage + 1 : 1;
      const commitsSinceDate = resumeState?.commits?.lastDate || null;

      setProgress(prev => ({ ...prev, status: 'Fetching all data (parallel)...' }));

      // Fetch all data types in parallel for speed, with incremental saving
      const [starsResult, forksResult, issuesResult, prsResult, commitsResult] = await Promise.all([
        fetchAllStargazersGraphQL(token, owner, repo, updateProgress, starsCursor, onSave),
        fetchAllForks(octokit, owner, repo, updateProgress, forksStartPage, onSave),
        fetchAllIssues(octokit, owner, repo, updateProgress, issuesSinceDate, onSave),
        fetchAllPullRequests(octokit, owner, repo, updateProgress, prsStartPage, onSave),
        fetchContributorCommits(octokit, owner, repo, updateProgress, commitsSinceDate, onSave)
      ]);

      console.log(`Stars fetch: ${starsResult.stargazers.length} stars, hasMore: ${starsResult.hasMorePages}, hitRateLimit: ${starsResult.hitRateLimit}`);
      console.log(`Forks fetch: ${forksResult.forks.length} forks, hitLimit: ${forksResult.hitPaginationLimit}, lastPage: ${forksResult.lastPage}`);
      console.log(`Issues fetch: ${issuesResult.issues.length} issues, hitLimit: ${issuesResult.hitPaginationLimit}, lastDate: ${issuesResult.lastDate}`);
      console.log(`PRs fetch: ${prsResult.prs.length} PRs, hitLimit: ${prsResult.hitPaginationLimit}, lastPage: ${prsResult.lastPage}`);
      console.log(`Commits fetch: ${commitsResult.commits.length} commits, hitLimit: ${commitsResult.hitPaginationLimit}, lastDate: ${commitsResult.lastDate}`);
      if (!silent) {
        setProgress(prev => ({ ...prev, commits: { ...prev.commits, done: true, partial: commitsResult.hitPaginationLimit } }));
        setProgress({ status: 'Processing data...' });
      }
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
        if (!silent) setProgress({ status: 'Merging with cached data...' });
        const existingData = transformCachedMetrics(cached.metrics);
        finalData = mergeDailyMetrics(existingData, newAggregated);
        console.log(`Merged ${existingData.length} cached days with ${newAggregated.length} new days = ${finalData.length} total days`);
      } else {
        finalData = newAggregated;
      }

      if (!silent) {
        setDailyData(finalData);
        setProgress({ status: 'Saving to cache...' });
      }

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

      // Mark fetch as complete
      await updateFetchProgress(owner, repo, { ...fetchState, inProgress: false });

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
      // Keep inProgress true on error so we can resume
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

  // Handle refreshing all cached repos (update data + calculate MoM metrics)
  const handleRefreshAll = async () => {
    if (!token) {
      setError('No GitHub token found. Please enter your token first.');
      return;
    }

    setRefreshingAll(true);
    setRefreshProgress('Loading repos...');

    try {
      const repos = await getCachedRepos();

      // Step 1: Update all repos to today (parallel with rate limit handling)
      const CONCURRENT_REFRESHES = 10;
      const repoQueue = [...repos];
      let completed = 0;
      const activeRepos = new Set();

      const updateProgressDisplay = () => {
        const active = Array.from(activeRepos).join(', ');
        setRefreshProgress(`Updating: ${active || 'starting...'} (${completed}/${repos.length} done)`);
      };

      const refreshRepo = async (repo) => {
        const repoName = `${repo.owner}/${repo.repo}`;
        activeRepos.add(repoName);
        updateProgressDisplay();

        try {
          const cached = await getRepoFromCache(repo.owner, repo.repo);

          // Skip if already up to date (last data is from today)
          const today = new Date().toISOString().split('T')[0];
          if (cached?.lastDate === today) {
            console.log(`Skipping ${repoName} - already up to date`);
            return; // Skip API calls, finally block will still run
          }

          // Use full fetch state from cache for incremental updates
          const resumeState = cached?.fetchState ? {
            stars: cached.fetchState.stars,
            forks: cached.fetchState.forks,
            prs: cached.fetchState.prs,
            issues: { lastDate: cached.lastDate },
            commits: { lastDate: cached.lastDate }
          } : {
            issues: { lastDate: cached?.lastDate },
            commits: { lastDate: cached?.lastDate }
          };

          await fetchData(repo.owner, repo.repo, token, resumeState, true); // silent mode
        } catch (err) {
          // Check if rate limited - wait and retry
          const isRateLimit = err.status === 403 || err.status === 429 ||
            err.message?.toLowerCase().includes('rate limit');

          if (isRateLimit) {
            const resetTime = err.response?.headers?.['x-ratelimit-reset'];
            let waitMs = 60000;
            if (resetTime) {
              waitMs = Math.max(0, (parseInt(resetTime) * 1000) - Date.now()) + 5000;
            }
            const waitMins = Math.ceil(waitMs / 60000);
            setRefreshProgress(`Rate limited on ${repoName} - waiting ${waitMins}m... (${completed}/${repos.length} done)`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
            return refreshRepo(repo); // Retry
          }

          console.error(`Error updating ${repoName}:`, err);
        } finally {
          activeRepos.delete(repoName);
          completed++;
          updateProgressDisplay();
        }
      };

      const worker = async () => {
        while (repoQueue.length > 0) {
          const repo = repoQueue.shift();
          if (repo) {
            await refreshRepo(repo);
          }
        }
      };

      // Start concurrent workers
      updateProgressDisplay();
      const workers = [];
      for (let i = 0; i < Math.min(CONCURRENT_REFRESHES, repos.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      // Step 2: Calculate MoM metrics
      setRefreshProgress('Calculating MoM metrics...');
      await backfillAllMonthlyMetrics();

      setCacheKey(k => k + 1);
    } catch (err) {
      console.error('Error refreshing all repos:', err);
      setError(err.message || 'Failed to refresh repositories');
    } finally {
      setRefreshingAll(false);
      setRefreshProgress('');
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
            <BatchFetch
              token={token}
              onComplete={() => setCacheKey(k => k + 1)}
            />

            {/* Refresh All Repositories */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
              <h3 className="text-sm font-medium text-gray-700 mb-3">All Cached Repositories</h3>
              <button
                onClick={handleRefreshAll}
                disabled={refreshingAll || !token}
                className="w-full px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                title="Update all cached repositories and calculate MoM metrics"
              >
                {refreshingAll ? (
                  <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                  </svg>
                )}
                Refresh to Today
              </button>
              {refreshProgress && (
                <p className="text-xs text-blue-600 mt-2">{refreshProgress}</p>
              )}
            </div>
          </div>

          <div>
            <TokenSettings
              token={token}
              setToken={setToken}
              saveToken={saveToken}
              setSaveToken={setSaveToken}
            />
            <RateLimitStatus token={token} />
          </div>
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
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-4">GitHub Repository Analytics</h1>

            {/* Navigation Tabs */}
            <div className="flex gap-2">
              <button
                onClick={() => setActiveView('repoData')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeView === 'repoData'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Repo Data
              </button>
              <button
                onClick={() => setActiveView('compare')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeView === 'compare'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Repo Compare
              </button>
              <button
                onClick={() => setActiveView('trending')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeView === 'trending'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Trending
              </button>
            </div>
          </div>

          {/* Repo Data View */}
          {activeView === 'repoData' && (
            <>
              <CachedRepos
                key={cacheKey}
                onSelect={handleCachedRepoSelect}
                isLoading={isLoading}
              />

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
            </>
          )}

          {/* Compare View */}
          {activeView === 'compare' && (
            <CompareView />
          )}

          {/* Trending View */}
          {activeView === 'trending' && (
            <TrendingView token={token} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
