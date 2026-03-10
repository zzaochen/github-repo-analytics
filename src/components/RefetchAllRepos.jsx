import { useState, useRef, useEffect } from 'react';
import {
  createGitHubClient,
  fetchRepoInfo,
  fetchAllStargazersGraphQL,
  fetchAllForks,
  fetchAllIssues,
  fetchAllPullRequests,
  fetchContributorCommits
} from '../services/githubApi';
import { saveRepoToCache, getCachedRepos, clearMetricsForRepo } from '../services/supabase';
import { aggregateToDaily } from '../utils/dataAggregator';

export default function RefetchAllRepos({ token, user, onComplete }) {
  const [isFetching, setIsFetching] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [repos, setRepos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState({});
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const abortRef = useRef(false);

  // Warn before closing tab while fetching
  useEffect(() => {
    if (!isFetching) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isFetching]);

  const handleClick = async () => {
    const cached = await getCachedRepos();
    if (cached.length === 0) return;
    setRepos(cached);
    setShowConfirm(true);
  };

  const fetchSingleRepo = async (repoPath) => {
    const [owner, repo] = repoPath.split('/');

    try {
      // Step 1: Clear existing metrics
      setProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'deleting', message: 'Clearing old data...' }
      }));

      const clearResult = await clearMetricsForRepo(owner, repo);
      if (!clearResult.success) {
        throw new Error(`Failed to clear metrics: ${clearResult.error}`);
      }

      if (abortRef.current) return;

      // Step 2: Full fetch
      setProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'fetching', message: 'Fetching repo info...' }
      }));

      const octokit = createGitHubClient(token);
      const info = await fetchRepoInfo(octokit, owner, repo);

      if (abortRef.current) return;

      setProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'fetching', message: 'Fetching all metrics...' }
      }));

      const [starsResult, forksResult, issuesResult, prsResult, commitsResult] = await Promise.all([
        fetchAllStargazersGraphQL(token, owner, repo, () => {}),
        fetchAllForks(octokit, owner, repo, () => {}),
        fetchAllIssues(octokit, owner, repo, () => {}),
        fetchAllPullRequests(octokit, owner, repo, () => {}),
        fetchContributorCommits(octokit, owner, repo, () => {})
      ]);

      if (abortRef.current) return;

      setProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'fetching', message: 'Processing & saving...' }
      }));

      const aggregated = aggregateToDaily(
        info,
        starsResult.stargazers,
        forksResult.forks,
        issuesResult.issues,
        prsResult.prs,
        commitsResult.commits
      );

      const fetchState = {
        stars: {
          limited: starsResult.hasMorePages || starsResult.hitRateLimit,
          cursor: starsResult.lastCursor
        },
        forks: {
          lastPage: forksResult.hitPaginationLimit ? forksResult.lastPage : null,
          limited: forksResult.hitPaginationLimit
        },
        prs: {
          lastPage: prsResult.hitPaginationLimit ? prsResult.lastPage : null,
          limited: prsResult.hitPaginationLimit
        },
        issues: { lastDate: issuesResult.lastDate },
        commits: { lastDate: commitsResult.lastDate }
      };

      await saveRepoToCache(owner, repo, aggregated, false, fetchState);

      setProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'done', message: 'Complete!' }
      }));

    } catch (error) {
      console.error(`Error re-fetching ${repoPath}:`, error);

      let shortMessage = 'Failed';
      let errorDetails = error.message || 'Unknown error';

      if (error.status === 404) {
        shortMessage = 'Not found';
        errorDetails = `Repository "${repoPath}" not found.`;
      } else if (error.status === 401 || error.status === 403) {
        shortMessage = 'Auth error';
        errorDetails = `Access denied (${error.status}). ${error.message || ''}`;
      } else if (error.status === 429 || error.message?.toLowerCase().includes('rate limit')) {
        shortMessage = 'Rate limited';
        errorDetails = `GitHub API rate limit exceeded. ${error.message || ''}`;
      } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
        shortMessage = 'Network error';
        errorDetails = `Network error: ${error.message}`;
      } else if (error.status) {
        shortMessage = `Error ${error.status}`;
        errorDetails = `HTTP ${error.status}: ${error.message || 'Unknown error'}`;
      }

      setProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'error', message: shortMessage, errorDetails }
      }));
    }
  };

  const handleConfirm = async () => {
    setShowConfirm(false);
    abortRef.current = false;
    setIsFetching(true);

    // Initialize progress
    const initialProgress = {};
    repos.forEach(r => {
      const key = `${r.owner}/${r.repo}`;
      initialProgress[key] = { status: 'pending', message: 'Waiting...' };
    });
    setProgress(initialProgress);

    // Fetch sequentially
    for (let i = 0; i < repos.length; i++) {
      if (abortRef.current) break;
      setCurrentIndex(i);
      const key = `${repos[i].owner}/${repos[i].repo}`;
      await fetchSingleRepo(key);
    }

    setIsFetching(false);
    if (onComplete) onComplete();
  };

  const handleCancel = () => {
    abortRef.current = true;
    setIsFetching(false);
    setShowConfirm(false);
  };

  const handleClear = () => {
    setProgress({});
    setRepos([]);
    setCurrentIndex(0);
  };

  const completedCount = Object.values(progress).filter(p => p.status === 'done').length;
  const errorCount = Object.values(progress).filter(p => p.status === 'error').length;
  const totalCount = Object.keys(progress).length;
  const isComplete = !isFetching && totalCount > 0 && completedCount + errorCount === totalCount;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">Reset Metrics</h3>
        {isFetching && (
          <span className="text-xs text-blue-600">{completedCount + errorCount}/{totalCount}</span>
        )}
        {isComplete && (
          <span className="text-xs text-green-600">{completedCount}/{totalCount} complete</span>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-3">
        Delete all metrics and re-fetch every cached repo from scratch.
      </p>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
          <p className="text-xs text-yellow-800 font-medium mb-1">
            This will re-fetch {repos.length} {repos.length === 1 ? 'repository' : 'repositories'} sequentially.
          </p>
          <p className="text-xs text-yellow-700 mb-3">
            This may take a long time for large repos. Do not close the tab while running.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowConfirm(false)}
              className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded text-xs transition-colors"
            >
              Confirm Reset
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!showConfirm && (
        <div>
          {!isFetching ? (
            <button
              onClick={handleClick}
              disabled={!user || isFetching}
              className="w-full px-3 py-2 bg-red-500 hover:bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              title={user ? 'Reset and re-fetch all cached repositories' : 'Sign in first'}
            >
              Reset Metrics
            </button>
          ) : (
            <button
              onClick={handleCancel}
              className="w-full px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              Abort
            </button>
          )}
          {isComplete && (
            <button
              onClick={handleClear}
              className="w-full mt-2 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="mt-3">
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${((completedCount + errorCount) / totalCount) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Repo {Math.min(currentIndex + 1, totalCount)} of {totalCount}
          </p>
        </div>
      )}

      {/* Progress list */}
      {totalCount > 0 && (
        <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
          {Object.entries(progress).map(([repo, { status, message }]) => (
            <div key={repo} className="flex items-center gap-2 text-xs">
              {status === 'pending' && (
                <span className="w-4 h-4 text-gray-400">○</span>
              )}
              {status === 'deleting' && (
                <svg className="w-4 h-4 text-orange-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {status === 'fetching' && (
                <svg className="w-4 h-4 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {status === 'done' && (
                <span className="w-4 h-4 text-green-500">✓</span>
              )}
              {status === 'error' && (
                <span className="w-4 h-4 text-red-500">✗</span>
              )}
              <span className={`flex-1 truncate ${status === 'error' ? 'text-red-600' : 'text-gray-700'}`}>
                {repo}
              </span>
              <span className="text-gray-400 text-right whitespace-nowrap">
                {message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Error details */}
      {errorCount > 0 && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          <button
            onClick={() => setShowErrorDetails(!showErrorDetails)}
            className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
          >
            <span>{showErrorDetails ? '▼' : '▶'}</span>
            <span>{errorCount} {errorCount === 1 ? 'error' : 'errors'} occurred</span>
          </button>

          {showErrorDetails && (
            <div className="mt-2 space-y-2">
              {Object.entries(progress)
                .filter(([, p]) => p.status === 'error')
                .map(([repo, { message, errorDetails }]) => (
                  <div key={repo} className="bg-red-50 border border-red-200 rounded p-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-red-500 font-medium">{repo}</span>
                      <span className="text-red-400">— {message}</span>
                    </div>
                    {errorDetails && (
                      <p className="text-xs text-red-600 mt-1 break-words">
                        {errorDetails}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
