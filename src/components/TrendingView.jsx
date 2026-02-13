import { useState, useEffect } from 'react';
import { fetchTrendingRepos, filterNewRepos } from '../services/trendingScraper';
import { getCachedRepos } from '../services/supabase';
import {
  createGitHubClient,
  fetchRepoInfo,
  fetchAllStargazersGraphQL,
  fetchAllForks,
  fetchAllIssues,
  fetchAllPullRequests,
  fetchContributorCommits
} from '../services/githubApi';
import { saveRepoToCache } from '../services/supabase';
import { aggregateToDaily } from '../utils/dataAggregator';

export default function TrendingView({ token }) {
  const [trendingRepos, setTrendingRepos] = useState([]);
  const [newRepos, setNewRepos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [fetchProgress, setFetchProgress] = useState({}); // { 'owner/repo': { status, message } }
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(false);
  const [discoveryDates, setDiscoveryDates] = useState({}); // { 'owner/repo': Date }

  const checkTrending = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch trending repos from GitHub
      const trending = await fetchTrendingRepos('weekly');
      setTrendingRepos(trending);

      // Get cached repos from Supabase
      const cached = await getCachedRepos();

      // Filter to find net new repos
      const netNew = filterNewRepos(trending, cached);
      setNewRepos(netNew);

      const checkDate = new Date();
      setLastChecked(checkDate);

      // Record discovery date for new repos
      const newDiscoveryDates = { ...discoveryDates };
      netNew.forEach(repo => {
        if (!newDiscoveryDates[repo.fullName]) {
          newDiscoveryDates[repo.fullName] = checkDate;
        }
      });
      setDiscoveryDates(newDiscoveryDates);

      return netNew;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const fetchSingleRepo = async (repoPath) => {
    if (!token) {
      setFetchProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'error', message: 'No GitHub token' }
      }));
      return;
    }

    const [owner, repo] = repoPath.split('/');

    try {
      setFetchProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'fetching', message: 'Fetching repo info...' }
      }));

      const octokit = createGitHubClient(token);
      const info = await fetchRepoInfo(octokit, owner, repo);

      setFetchProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'fetching', message: 'Fetching data...' }
      }));

      // Fetch all data types in parallel
      const [starsResult, forksResult, issuesResult, prsResult, commitsResult] = await Promise.all([
        fetchAllStargazersGraphQL(token, owner, repo, () => {}),
        fetchAllForks(octokit, owner, repo, () => {}),
        fetchAllIssues(octokit, owner, repo, () => {}),
        fetchAllPullRequests(octokit, owner, repo, () => {}),
        fetchContributorCommits(octokit, owner, repo, () => {})
      ]);

      setFetchProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'fetching', message: 'Processing...' }
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

      setFetchProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'done', message: 'Complete!' }
      }));

      // Remove from newRepos list
      setNewRepos(prev => prev.filter(r => r.fullName !== repoPath));

    } catch (err) {
      console.error(`Error fetching ${repoPath}:`, err);
      setFetchProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'error', message: err.message || 'Failed' }
      }));
    }
  };

  const fetchAllNewRepos = async () => {
    if (!token || newRepos.length === 0) return;

    // Initialize progress for all
    const initialProgress = {};
    newRepos.forEach(r => {
      initialProgress[r.fullName] = { status: 'pending', message: 'Queued...' };
    });
    setFetchProgress(initialProgress);

    // Fetch sequentially to avoid rate limits
    for (const repo of newRepos) {
      await fetchSingleRepo(repo.fullName);
    }
  };

  const formatNumber = (num) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <div>
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">GitHub Weekly Trending</h2>
            <p className="text-sm text-gray-500">
              Discover this week's trending repositories and auto-fetch their data
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={checkTrending}
              disabled={loading}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {loading ? 'Checking...' : 'Check Weekly Trending'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {!token && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
            Enter a GitHub token in Settings to enable auto-fetching
          </div>
        )}
      </div>

      {/* Checked On Banner */}
      {lastChecked && trendingRepos.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-blue-700">
              <strong>Checked on:</strong> {lastChecked.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          </div>
          {newRepos.length > 0 && (
            <span className="text-sm text-blue-600 font-medium">
              {newRepos.length} new repo{newRepos.length !== 1 ? 's' : ''} discovered
            </span>
          )}
        </div>
      )}

      {/* Stats */}
      {trendingRepos.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-2xl font-bold text-gray-900">{trendingRepos.length}</div>
            <div className="text-sm text-gray-500">Weekly Trending</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-2xl font-bold text-green-600">{newRepos.length}</div>
            <div className="text-sm text-gray-500">New (Not Cached)</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-2xl font-bold text-blue-600">
              {trendingRepos.length - newRepos.length}
            </div>
            <div className="text-sm text-gray-500">Already Cached</div>
          </div>
        </div>
      )}

      {/* New Repos Section */}
      {newRepos.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-md font-semibold text-gray-900">
              New Trending Repos ({newRepos.length})
            </h3>
            {token && (
              <button
                onClick={fetchAllNewRepos}
                disabled={Object.values(fetchProgress).some(p => p.status === 'fetching')}
                className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-medium disabled:opacity-50 transition-colors"
              >
                Fetch All New Repos
              </button>
            )}
          </div>

          <div className="space-y-2">
            {newRepos.map((repo) => {
              const progress = fetchProgress[repo.fullName];
              return (
                <div
                  key={repo.fullName}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://github.com/${repo.fullName}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {repo.fullName}
                      </a>
                      {repo.language && (
                        <span className="px-2 py-0.5 bg-gray-200 rounded text-xs text-gray-600">
                          {repo.language}
                        </span>
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-1">
                        {repo.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                      <span>★ {formatNumber(repo.stars)}</span>
                      <span>+{formatNumber(repo.starsGained)} stars this week</span>
                      <span>🍴 {formatNumber(repo.forks)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    {progress ? (
                      <div className="flex items-center gap-2 text-sm">
                        {progress.status === 'pending' && (
                          <span className="text-gray-400">○ {progress.message}</span>
                        )}
                        {progress.status === 'fetching' && (
                          <>
                            <svg className="w-4 h-4 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="text-blue-600">{progress.message}</span>
                          </>
                        )}
                        {progress.status === 'done' && (
                          <span className="text-green-600">✓ {progress.message}</span>
                        )}
                        {progress.status === 'error' && (
                          <span className="text-red-600">✗ {progress.message}</span>
                        )}
                      </div>
                    ) : (
                      token && (
                        <button
                          onClick={() => fetchSingleRepo(repo.fullName)}
                          className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs transition-colors"
                        >
                          Fetch
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All Trending Repos */}
      {trendingRepos.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <h3 className="text-md font-semibold text-gray-900 mb-4">
            All Weekly Trending Repos ({trendingRepos.length})
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">Repository</th>
                  <th className="pb-2 font-medium">Language</th>
                  <th className="pb-2 font-medium text-right">Stars</th>
                  <th className="pb-2 font-medium text-right">Stars This Week</th>
                  <th className="pb-2 font-medium text-right">Status</th>
                  <th className="pb-2 font-medium text-right">Discovered</th>
                </tr>
              </thead>
              <tbody>
                {trendingRepos.map((repo, index) => {
                  const isCached = !newRepos.find(r => r.fullName === repo.fullName);
                  return (
                    <tr key={repo.fullName} className="border-b border-gray-100">
                      <td className="py-2 text-gray-400">{index + 1}</td>
                      <td className="py-2">
                        <a
                          href={`https://github.com/${repo.fullName}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {repo.fullName}
                        </a>
                      </td>
                      <td className="py-2 text-gray-500">{repo.language || '-'}</td>
                      <td className="py-2 text-right">{formatNumber(repo.stars)}</td>
                      <td className="py-2 text-right text-green-600">
                        +{formatNumber(repo.starsGained)}
                      </td>
                      <td className="py-2 text-right">
                        {isCached ? (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                            Cached
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                            New
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right text-gray-500 text-xs">
                        {discoveryDates[repo.fullName]
                          ? discoveryDates[repo.fullName].toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })
                          : isCached ? 'Previously' : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && trendingRepos.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <p className="text-lg">Click "Check Weekly Trending" to discover this week's trending repositories</p>
          <p className="text-sm mt-1">We'll find repos you haven't cached yet</p>
        </div>
      )}
    </div>
  );
}
