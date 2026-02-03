import { useState } from 'react';
import RepoInput from './components/RepoInput';
import LoadingProgress from './components/LoadingProgress';
import Dashboard from './components/Dashboard';
import {
  createGitHubClient,
  fetchRepoInfo,
  fetchAllStargazers,
  fetchAllForks,
  fetchAllIssues,
  fetchAllPullRequests,
  fetchContributorCommits
} from './services/githubApi';
import { getRepoFromCache, saveRepoToCache, transformCachedMetrics } from './services/supabase';
import { aggregateToDaily } from './utils/dataAggregator';

function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [repoInfo, setRepoInfo] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [progress, setProgress] = useState({});

  const handleSubmit = async (owner, repo, token) => {
    setIsLoading(true);
    setError(null);
    setProgress({});

    try {
      // Check cache first
      setProgress({ status: 'Checking cache...' });
      const cached = await getRepoFromCache(owner, repo);

      if (cached && cached.metrics.length > 0) {
        setProgress({ status: 'Loading from cache...' });
        const octokit = createGitHubClient(token);
        const info = await fetchRepoInfo(octokit, owner, repo);
        setRepoInfo(info);
        setDailyData(transformCachedMetrics(cached.metrics));
        setIsLoading(false);
        return;
      }

      // Fetch fresh data
      const octokit = createGitHubClient(token);

      setProgress({ status: 'Fetching repository info...' });
      const info = await fetchRepoInfo(octokit, owner, repo);
      setRepoInfo(info);

      const updateProgress = (update) => {
        setProgress(prev => ({
          ...prev,
          [update.type]: { fetched: update.fetched }
        }));
      };

      // Fetch all data
      setProgress(prev => ({ ...prev, status: 'Fetching stars...' }));
      const stargazers = await fetchAllStargazers(octokit, owner, repo, updateProgress);
      setProgress(prev => ({ ...prev, stars: { ...prev.stars, done: true } }));

      setProgress(prev => ({ ...prev, status: 'Fetching forks...' }));
      const forks = await fetchAllForks(octokit, owner, repo, updateProgress);
      setProgress(prev => ({ ...prev, forks: { ...prev.forks, done: true } }));

      setProgress(prev => ({ ...prev, status: 'Fetching issues...' }));
      const issues = await fetchAllIssues(octokit, owner, repo, updateProgress);
      setProgress(prev => ({ ...prev, issues: { ...prev.issues, done: true } }));

      setProgress(prev => ({ ...prev, status: 'Fetching pull requests...' }));
      const prs = await fetchAllPullRequests(octokit, owner, repo, updateProgress);
      setProgress(prev => ({ ...prev, prs: { ...prev.prs, done: true } }));

      setProgress(prev => ({ ...prev, status: 'Fetching commits for contributor data...' }));
      const commits = await fetchContributorCommits(octokit, owner, repo, updateProgress);
      setProgress(prev => ({ ...prev, commits: { ...prev.commits, done: true } }));

      // Aggregate data
      setProgress({ status: 'Processing data...' });
      const aggregated = aggregateToDaily(info, stargazers, forks, issues, prs, commits);
      setDailyData(aggregated);

      // Save to cache
      setProgress({ status: 'Saving to cache...' });
      await saveRepoToCache(owner, repo, aggregated);

    } catch (err) {
      console.error('Error fetching repo:', err);
      setError(err.message || 'Failed to fetch repository data');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">GitHub Repository Analytics</h1>

        <RepoInput onSubmit={handleSubmit} isLoading={isLoading} />

        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {isLoading && <LoadingProgress progress={progress} />}

        {!isLoading && dailyData && repoInfo && (
          <Dashboard repoInfo={repoInfo} dailyData={dailyData} />
        )}
      </div>
    </div>
  );
}

export default App;
