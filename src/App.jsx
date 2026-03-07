import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, useSearchParams } from 'react-router-dom';
import LoadingProgress from './components/LoadingProgress';
import Dashboard from './components/Dashboard';
import CachedRepos from './components/CachedRepos';
import TokenSettings from './components/TokenSettings';
import CompareView from './components/CompareView';
import TrendingView from './components/TrendingView';
import MilestonesView from './components/MilestonesView';
import ChatView from './components/ChatView';
import PRTimeline from './components/PRTimeline';
import HomePage from './components/HomePage';
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
  deleteRepoFromCache,
  backfillAllMonthlyMetrics,
  getCachedRepos,
  updateFetchProgress,
  getOrCreateRepo,
  signInWithGitHub,
  signOut,
  getSession,
  onAuthStateChange,
  getLastCronRun
} from './services/supabase';
import { aggregateToDaily, aggregateIncrementalToDaily } from './utils/dataAggregator';

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
  const [companyInfo, setCompanyInfo] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [prTimelineOpen, setPrTimelineOpen] = useState(false);
  const [prTimelineKey, setPrTimelineKey] = useState(0);
  const [token, setToken] = useState('');
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState('');
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [lastCronRun, setLastCronRun] = useState(null);

  const TOKEN_KEY = 'github_analytics_token';

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    }
  }, [token]);

  // Auth state management
  useEffect(() => {
    getSession().then(session => {
      if (session) {
        setUser(session.user);
        if (session.provider_token) {
          setToken(session.provider_token);
        }
      }
    });

    const { data: { subscription } } = onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user);
        if (session.provider_token) {
          setToken(session.provider_token);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setToken('');
        localStorage.removeItem(TOKEN_KEY);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch last cron run time for refresh-repos job
  useEffect(() => {
    const fetchLastCronRun = async () => {
      const cronData = await getLastCronRun('refresh-repos');
      setLastCronRun(cronData);
    };
    fetchLastCronRun();
  }, []);

  // Auto-load repo from query params on /lookup (e.g. /lookup?owner=facebook&repo=react)
  useEffect(() => {
    if (location.pathname === '/lookup') {
      const owner = searchParams.get('owner');
      const repo = searchParams.get('repo');
      if (owner && repo) {
        handleCachedRepoSelect(owner, repo);
      }
    }
  }, [location.pathname, searchParams]);

  const handleSignIn = async () => {
    setAuthLoading(true);
    const { error } = await signInWithGitHub();
    if (error) {
      console.error('GitHub sign-in error:', error);
    }
    setAuthLoading(false);
  };

  const handleSignOut = async () => {
    setAuthLoading(true);
    await signOut();
    setUser(null);
    setToken('');
    localStorage.removeItem(TOKEN_KEY);
    setAuthLoading(false);
  };

  // Load from cache only (no fetching)
  const loadFromCache = async (owner, repo, token) => {
    setIsLoading(true);
    setError(null);
    setProgress({ status: 'Loading from cache...' });

    try {
      const cached = await getRepoFromCache(owner, repo);
      console.log('Cache result:', cached);

      if (cached && cached.metrics.length > 0) {
        // If we have a token, fetch live repo info; otherwise use cached data
        let info;
        if (token) {
          const octokit = createGitHubClient(token);
          info = await fetchRepoInfo(octokit, owner, repo);
        } else {
          // Build basic repo info from cached data
          const lastMetric = cached.metrics[cached.metrics.length - 1];
          info = {
            name: `${owner}/${repo}`,
            description: cached.repository.description || '',
            stars: lastMetric?.total_stars || lastMetric?.totalStars || 0,
            forks: lastMetric?.total_forks || lastMetric?.totalForks || 0,
            openIssues: 0,
            createdAt: cached.repository.created_at
          };
        }
        setRepoInfo(info);
        const transformedData = transformCachedMetrics(cached.metrics);
        console.log('Transformed data sample (last 3 days):', JSON.stringify(transformedData.slice(-3), null, 2));
        console.log('Raw cached metrics sample (last 3):', JSON.stringify(cached.metrics.slice(-3), null, 2));
        setDailyData(transformedData);
        setDataSource('cache');
        setLastFetched(cached.repository.last_fetched);
        // Set company info from cached repository
        setCompanyInfo({
          company_name: cached.repository.company_name,
          company_url: cached.repository.company_url
        });
        // Check if any metric is pagination limited
        const anyLimited = cached.fetchState?.stars?.limited ||
                          cached.fetchState?.forks?.limited ||
                          cached.fetchState?.prs?.limited;
        setStarsPaginationLimited(anyLimited || false);
      } else {
        // No cache found
        if (token) {
          console.log('No cache found, fetching from GitHub...');
          await fetchData(owner, repo, token, null); // null = fresh fetch, no resume state
        } else {
          setError('No cached data found for this repository. Sign in to fetch fresh data.');
        }
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
  // existingCounts: { stars, forks } - for refresh operations, shows progress relative to new data
  const fetchData = async (owner, repo, token, resumeState = null, silent = false, existingCounts = null) => {
    const isResuming = !!resumeState;
    const isRefresh = isResuming && existingCounts;

    try {
      if (!silent) {
        if (isRefresh) {
          setProgress({ status: 'Updating to today...' });
        } else if (isResuming) {
          setProgress({ status: 'Resuming data fetch...' });
        } else {
          setProgress({ status: 'Fetching data...' });
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

      // For refresh operations, calculate how many NEW items to fetch
      const newToFetch = isRefresh ? {
        stars: Math.max(0, info.stars - (existingCounts.stars || 0)),
        forks: Math.max(0, info.forks - (existingCounts.forks || 0))
      } : null;

      const updateProgress = silent ? () => {} : (update) => {
        setProgress(prev => ({
          ...prev,
          isRefresh,
          existingCounts,
          totals: isRefresh ? newToFetch : {
            stars: info.stars,
            forks: info.forks,
            issues: info.openIssues
          },
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
      // Use sinceDate for incremental fetch when no cursor/lastPage is available
      const sinceDate = resumeState?.sinceDate || null;
      // Only use sinceDate if we don't have a saved position
      const starsSinceDate = starsCursor ? null : sinceDate;
      const forksSinceDate = forksStartPage > 1 ? null : sinceDate;
      const prsSinceDate = prsStartPage > 1 ? null : sinceDate;

      setProgress(prev => ({ ...prev, status: 'Fetching data...' }));

      // Fetch all data types in parallel for speed, with incremental saving
      const [starsResult, forksResult, issuesResult, prsResult, commitsResult] = await Promise.all([
        fetchAllStargazersGraphQL(token, owner, repo, updateProgress, starsCursor, onSave, starsSinceDate),
        fetchAllForks(octokit, owner, repo, updateProgress, forksStartPage, onSave, forksSinceDate),
        fetchAllIssues(octokit, owner, repo, updateProgress, issuesSinceDate, onSave),
        fetchAllPullRequests(octokit, owner, repo, updateProgress, prsStartPage, onSave, prsSinceDate),
        fetchContributorCommits(octokit, owner, repo, updateProgress, commitsSinceDate, onSave)
      ]);

      console.log(`Stars fetch: ${starsResult.stargazers.length} stars, hasMore: ${starsResult.hasMorePages}, hitRateLimit: ${starsResult.hitRateLimit}`);
      console.log(`Forks fetch: ${forksResult.forks.length} forks, hitLimit: ${forksResult.hitPaginationLimit}, lastPage: ${forksResult.lastPage}`);
      console.log(`Issues fetch: ${issuesResult.issues.length} issues, hitLimit: ${issuesResult.hitPaginationLimit}, lastDate: ${issuesResult.lastDate}`);
      console.log(`PRs fetch: ${prsResult.prs.length} PRs, hitLimit: ${prsResult.hitPaginationLimit}, lastPage: ${prsResult.lastPage}`);
      console.log(`Commits fetch: ${commitsResult.commits.length} commits, hitLimit: ${commitsResult.hitPaginationLimit}, lastDate: ${commitsResult.lastDate}`);
      if (!silent) {
        // Mark all metrics as done
        setProgress(prev => ({
          ...prev,
          stars: { ...prev.stars, done: true, fetched: starsResult.stargazers.length },
          forks: { ...prev.forks, done: true, fetched: forksResult.forks.length },
          issues: { ...prev.issues, done: true, fetched: issuesResult.issues.length },
          prs: { ...prev.prs, done: true, fetched: prsResult.prs.length },
          commits: { ...prev.commits, done: true, fetched: commitsResult.commits.length },
          status: 'Processing data...'
        }));
      }

      let finalData;
      const cached = await getRepoFromCache(owner, repo);

      if (sinceDate && cached && cached.metrics.length > 0) {
        // Incremental update: use the new function that continues from existing totals
        if (!silent) setProgress({ status: 'Processing incremental data...' });
        const existingData = transformCachedMetrics(cached.metrics);
        finalData = aggregateIncrementalToDaily(
          existingData,
          sinceDate,
          starsResult.stargazers,
          forksResult.forks,
          issuesResult.issues,
          prsResult.prs,
          commitsResult.commits
        );
        console.log(`Incremental update: ${existingData.length} existing days + new data since ${sinceDate} = ${finalData.length} total days`);
      } else {
        // Full fetch: aggregate from scratch
        const newAggregated = aggregateToDaily(
          info,
          starsResult.stargazers,
          forksResult.forks,
          issuesResult.issues,
          prsResult.prs,
          commitsResult.commits
        );
        finalData = newAggregated;
        console.log(`Full fetch: ${finalData.length} days of data`);
      }

      if (!silent) {
        console.log('=== Setting UI Data ===');
        console.log('finalData length:', finalData.length);
        console.log('finalData last 3 days:', finalData.slice(-3));
        setDailyData(finalData);
        setProgress({ status: 'Saving to cache...' });
      }

      // Track fetch state for all metrics
      // ALWAYS save cursor/lastPage so refresh operations can resume from there
      const fetchState = {
        stars: {
          lastPage: null, // Not used for GraphQL
          limited: starsResult.hasMorePages || starsResult.hitRateLimit,
          cursor: starsResult.lastCursor // Always save cursor for incremental refresh
        },
        forks: {
          lastPage: forksResult.lastPage, // Always save for incremental refresh
          limited: forksResult.hitPaginationLimit
        },
        prs: {
          lastPage: prsResult.lastPage, // Always save for incremental refresh
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

      console.log('Saving to cache with isResuming:', isResuming);
      await saveRepoToCache(owner, repo, finalData, isResuming, fetchState);
      console.log('Cache save complete');

      // Mark fetch as complete
      await updateFetchProgress(owner, repo, { ...fetchState, inProgress: false });
      console.log('Fetch progress updated');

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
        // Set company info from cached repository
        setCompanyInfo({
          company_name: cached.repository.company_name,
          company_url: cached.repository.company_url
        });
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
      // Use lastDate directly - we'll overwrite the last day and add new days
      // This ensures: keep data before lastDate, overwrite lastDate, add new days
      const lastDate = cached?.lastDate;
      const sinceDate = lastDate ? `${lastDate}T00:00:00Z` : null;

      // Debug logging
      console.log('=== Update to Today Debug ===');
      console.log('cached.lastDate:', lastDate);
      console.log('sinceDate (will overwrite this day + add new):', sinceDate);

      // For "Update to Today", ALWAYS use date-based approach (not cursor)
      // Cursor is only for "Continue Fetching" interrupted fetches
      // Date-based: fetch newest first, stop when hitting data older than sinceDate
      const resumeState = {
        // Don't pass cursor/lastPage - use sinceDate for all metrics
        stars: { cursor: null },
        forks: { lastPage: null },
        prs: { lastPage: null },
        issues: { lastDate: lastDate },
        commits: { lastDate: lastDate },
        sinceDate: sinceDate
      };

      console.log('Data before', lastDate, 'will be kept, data from', lastDate, 'onwards will be refreshed');
      console.log('=== End Debug ===');

      // Get existing counts from last cached metric for progress display
      const lastMetric = cached?.metrics?.[cached.metrics.length - 1];
      const existingCounts = lastMetric ? {
        stars: lastMetric.total_stars || lastMetric.totalStars || 0,
        forks: lastMetric.total_forks || lastMetric.totalForks || 0
      } : null;

      await fetchData(owner, repo, token, resumeState, false, existingCounts);
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
    loadFromCache(owner, repo, token); // Works with or without token for cached data
  };

  // Handle refreshing all cached repos (update data + calculate MoM metrics)
  const handleRefreshAll = async () => {
    if (!user) {
      setError('Please sign in to refresh repositories.');
      return;
    }
    if (!token) {
      setError('No GitHub token found. Please sign in again.');
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

      const updateProgressDisplay = () => {
        setRefreshProgress(`Updating repos... (${completed}/${repos.length} done)`);
      };

      const refreshRepo = async (repo) => {
        const repoName = `${repo.owner}/${repo.repo}`;

        try {
          const cached = await getRepoFromCache(repo.owner, repo.repo);

          // Skip if already up to date (last data is from today)
          const today = new Date().toISOString().split('T')[0];
          if (cached?.lastDate === today) {
            console.log(`Skipping ${repoName} - already up to date`);
            return; // Skip API calls, finally block will still run
          }

          // Use date-based incremental fetch (not cursor-based)
          // Use lastDate directly - we'll overwrite the last day and add new days
          // This ensures: keep data before lastDate, overwrite lastDate, add new days
          const lastDate = cached?.lastDate;
          const sinceDate = lastDate ? `${lastDate}T00:00:00Z` : null;
          const resumeState = {
            stars: { cursor: null },
            forks: { lastPage: null },
            prs: { lastPage: null },
            issues: { lastDate: lastDate },
            commits: { lastDate: lastDate },
            sinceDate: sinceDate
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
    if (!user) {
      setError('Please sign in to delete and re-fetch repositories.');
      return;
    }

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

  const compact = chatOpen || prTimelineOpen;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-64 xl:w-80' : 'w-0'
        } transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0`}
      >
        <div className={`w-64 xl:w-80 h-screen bg-white border-r border-gray-200 p-3 xl:p-4 fixed flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
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

          {/* Sign-in prompt when not authenticated */}
          {!user ? (
            <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <h3 className="text-base font-semibold text-gray-900 mb-4">Sign In Required</h3>
              <button
                onClick={handleSignIn}
                disabled={authLoading}
                className="w-full px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {authLoading ? 'Signing in...' : 'Sign in with GitHub'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                <BatchFetch
                  token={token}
                  user={user}
                  onComplete={() => setCacheKey(k => k + 1)}
                />
              </div>

              <div>
                {/* Refresh All Repositories */}
                <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">All Cached Repositories</h3>
                  <button
                    onClick={handleRefreshAll}
                    disabled={refreshingAll}
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
                  {lastCronRun && (
                    <p className="text-xs text-gray-500 mt-2">
                      Last auto-refresh: {new Date(lastCronRun.run_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZoneName: 'short'
                      })}
                    </p>
                  )}
                </div>

                <TokenSettings
                  user={user}
                  onSignIn={handleSignIn}
                  onSignOut={handleSignOut}
                  authLoading={authLoading}
                />
                <RateLimitStatus token={token} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {/* Top Navigation Bar */}
        <div className="bg-white border-b border-gray-200 px-3 py-2">
          <div className="flex items-center justify-between w-full gap-2">
            {/* Left section: hamburger menu and title */}
            <div className="flex items-center gap-2 shrink-0">
              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                  title="Show sidebar"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
              <Link to="/" className={`${compact ? 'text-sm' : 'text-sm xl:text-base'} font-bold text-gray-900 hover:text-blue-600 transition-colors flex items-center gap-2`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {!compact && <span className="hidden xl:inline">GitHub Repository Analytics</span>}
              </Link>
            </div>
            <nav className={`flex items-center ${compact ? 'gap-1.5' : 'gap-1.5 lg:gap-3'} min-w-0`}>
              <Link
                to="/lookup"
                className={`text-xs ${compact ? '' : 'lg:text-sm'} font-medium transition-colors whitespace-nowrap ${
                  location.pathname === '/lookup'
                    ? 'text-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {compact ? 'Lookup' : <><span className="hidden lg:inline">Repo </span>Lookup</>}
              </Link>
              <Link
                to="/compare"
                className={`text-xs ${compact ? '' : 'lg:text-sm'} font-medium transition-colors whitespace-nowrap ${
                  location.pathname === '/compare'
                    ? 'text-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Compare
              </Link>
              <Link
                to="/trending"
                className={`text-xs ${compact ? '' : 'lg:text-sm'} font-medium transition-colors whitespace-nowrap ${
                  location.pathname === '/trending'
                    ? 'text-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Trending
              </Link>
              <Link
                to="/milestones"
                className={`text-xs ${compact ? '' : 'lg:text-sm'} font-medium transition-colors whitespace-nowrap ${
                  location.pathname === '/milestones'
                    ? 'text-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Milestones
              </Link>
              {/* AI Fetch Button */}
              {!chatOpen && (
                <button
                  onClick={() => { setChatOpen(true); setPrTimelineOpen(false); }}
                  className={`pl-2 ${compact ? '' : 'lg:pl-4'} border-l border-gray-200 flex items-center gap-1 text-xs ${compact ? '' : 'lg:text-sm'} font-medium text-gray-600 hover:text-gray-900 transition-colors`}
                  title="Open AI Fetch"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  {!compact && <span className="hidden lg:inline">AI Fetch</span>}
                </button>
              )}
              {/* Auth Button */}
              {user ? (
                <div className={`flex items-center gap-2 pl-2 ${compact ? '' : 'lg:pl-4'} border-l border-gray-200`}>
                  {user.user_metadata?.avatar_url && (
                    <img
                      src={user.user_metadata.avatar_url}
                      alt="Avatar"
                      className="w-6 h-6 rounded-full"
                    />
                  )}
                  <button
                    onClick={handleSignOut}
                    disabled={authLoading}
                    className="text-xs text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleSignIn}
                  disabled={authLoading}
                  className={`pl-2 ${compact ? '' : 'lg:pl-4'} border-l border-gray-200 flex items-center gap-1 text-xs ${compact ? '' : 'lg:text-sm'} font-medium text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  {authLoading ? '...' : 'Sign In'}
                </button>
              )}
            </nav>
          </div>
        </div>

        <div className={`${sidebarOpen && compact ? 'max-w-5xl' : sidebarOpen || compact ? 'max-w-7xl' : 'max-w-[1600px]'} mx-auto ${compact ? 'px-4 py-4' : 'px-4 lg:px-8 py-4 lg:py-8'}`}>
          <Routes>
            {/* Home - Trending Overview */}
            <Route path="/" element={<HomePage onRepoSelect={handleCachedRepoSelect} onOpenSidebar={() => setSidebarOpen(true)} />} />

            {/* Repo Lookup View */}
            <Route path="/lookup" element={
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
                    companyInfo={companyInfo}
                    onCompanyInfoUpdate={setCompanyInfo}
                    onOpenPrTimeline={() => { setPrTimelineOpen(true); setChatOpen(false); }}
                  />
                )}

                {!isLoading && !dailyData && (
                  <div className="text-center py-16 text-gray-500">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <p className="text-lg">Enter a repository to analyze</p>
                  </div>
                )}
              </>
            } />

            {/* Metrics Comparison View */}
            <Route path="/compare" element={<CompareView />} />

            {/* Trending View */}
            <Route path="/trending" element={<TrendingView token={token} />} />

            {/* Milestones View */}
            <Route path="/milestones" element={<MilestonesView />} />

          </Routes>
        </div>
      </div>

      {/* Right Sidebar - AI Fetch */}
      <div
        className={`${
          chatOpen ? 'w-80 xl:w-96' : 'w-0'
        } transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0`}
      >
        <div className={`w-80 xl:w-96 h-screen bg-white border-l border-gray-200 fixed right-0 top-0 flex flex-col transition-transform duration-300 ${chatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <h2 className="text-lg font-semibold text-gray-800">AI Fetch</h2>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              title="Hide chat"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatView />
          </div>
        </div>
      </div>

      {/* Right Sidebar - PR Timeline */}
      <div
        className={`${
          prTimelineOpen ? 'w-80 xl:w-96' : 'w-0'
        } transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0`}
      >
        <div className={`w-80 xl:w-96 h-screen bg-white border-l border-gray-200 fixed right-0 top-0 flex flex-col transition-transform duration-300 ${prTimelineOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-900" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              <h2 className="text-lg font-semibold text-gray-800">PR History</h2>
              <button
                onClick={() => setPrTimelineKey(k => k + 1)}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                title="Refresh PR History"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <button
                onClick={() => setPrTimelineOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                title="Close PR History"
              >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <PRTimeline key={prTimelineKey} repoName={repoInfo?.name} token={token} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
