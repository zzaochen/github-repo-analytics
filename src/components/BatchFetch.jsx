import { useState, useRef } from 'react';
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

export default function BatchFetch({ token, onComplete }) {
  const [repoList, setRepoList] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [progress, setProgress] = useState({}); // { 'owner/repo': { status: 'pending' | 'fetching' | 'done' | 'error', message: '' } }
  const abortRef = useRef(false);

  const parseRepos = (text) => {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.replace('https://github.com/', ''))
      .filter(line => line.includes('/'));
  };

  const fetchSingleRepo = async (repoPath) => {
    const [owner, repo] = repoPath.split('/');

    try {
      setProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'fetching', message: 'Fetching' }
      }));

      const octokit = createGitHubClient(token);
      const info = await fetchRepoInfo(octokit, owner, repo);

      if (abortRef.current) return;

      setProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'fetching', message: 'Fetching' }
      }));

      // Fetch all data types in parallel for speed
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
        [repoPath]: { status: 'fetching', message: 'Processing' }
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
      console.error(`Error fetching ${repoPath}:`, error);
      setProgress(prev => ({
        ...prev,
        [repoPath]: { status: 'error', message: error.message || 'Failed' }
      }));
    }
  };

  const handleStartFetch = async () => {
    const repos = parseRepos(repoList);
    if (repos.length === 0 || !token) return;

    abortRef.current = false;
    setIsFetching(true);

    // Initialize progress for all repos
    const initialProgress = {};
    repos.forEach(repo => {
      initialProgress[repo] = { status: 'pending', message: 'Starting...' };
    });
    setProgress(initialProgress);

    // Fetch all repos in parallel
    await Promise.allSettled(repos.map(repo => fetchSingleRepo(repo)));

    setIsFetching(false);
    if (onComplete) onComplete();
  };

  const handleCancel = () => {
    abortRef.current = true;
    setIsFetching(false);
  };

  const repos = parseRepos(repoList);
  const completedCount = Object.values(progress).filter(p => p.status === 'done').length;
  const errorCount = Object.values(progress).filter(p => p.status === 'error').length;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">Batch Fetch</h3>
        {isFetching && (
          <span className="text-xs text-blue-600">{completedCount}/{Object.keys(progress).length}</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-2">
        Enter repositories (one per line).<br />
        Format: owner/repo
      </p>
      <textarea
        value={repoList}
        onChange={(e) => setRepoList(e.target.value)}
        placeholder="facebook/react&#10;vercel/next.js&#10;supabase/supabase"
        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        rows={4}
        disabled={isFetching}
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-500">
          {repos.length} {repos.length === 1 ? 'repository' : 'repositories'}
        </span>
        {!isFetching ? (
          <button
            onClick={handleStartFetch}
            disabled={repos.length === 0 || !token}
            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs transition-colors"
          >
            Fetch All
          </button>
        ) : (
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded text-xs transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress list */}
      {Object.keys(progress).length > 0 && (
        <div className="mt-3 space-y-1">
          {Object.entries(progress).map(([repo, { status, message }]) => (
            <div key={repo} className="flex items-center gap-2 text-xs">
              {status === 'pending' && (
                <span className="w-4 h-4 text-gray-400">○</span>
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
              <span className={`flex-1 ${status === 'error' ? 'text-red-600' : 'text-gray-700'}`}>
                {repo}
              </span>
              <span className="text-gray-400 text-right">
                {message}
              </span>
            </div>
          ))}
        </div>
      )}

      {!isFetching && completedCount > 0 && (
        <p className="text-xs text-green-600 mt-2">
          Completed: {completedCount} repos{errorCount > 0 && `, ${errorCount} errors`}
        </p>
      )}
    </div>
  );
}
