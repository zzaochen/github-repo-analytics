import { useState, useEffect } from 'react';
import { fetchTrendingRepos } from '../services/trendingScraper';

const PERIODS = [
  { key: 'daily', label: 'Daily Trending', param: 'daily' },
  { key: 'weekly', label: 'Weekly Trending', param: 'weekly' },
  { key: 'monthly', label: 'Monthly Trending', param: 'monthly' }
];

export default function HomePage() {
  const [trendingData, setTrendingData] = useState({
    daily: { repos: [], loading: true, error: null },
    weekly: { repos: [], loading: true, error: null },
    monthly: { repos: [], loading: true, error: null }
  });
  const [sortBy, setSortBy] = useState('starsGained');
  const [fetchedAt, setFetchedAt] = useState(null);

  useEffect(() => {
    // Fetch all three periods in parallel
    PERIODS.forEach(({ key, param }) => {
      fetchTrendingRepos(param)
        .then(repos => {
          setTrendingData(prev => ({
            ...prev,
            [key]: { repos, loading: false, error: null }
          }));
          if (!fetchedAt) setFetchedAt(new Date());
        })
        .catch(err => {
          setTrendingData(prev => ({
            ...prev,
            [key]: { repos: [], loading: false, error: err.message }
          }));
        });
    });
  }, []);

  const getSortedRepos = (repos) => {
    return [...repos].sort((a, b) => {
      if (sortBy === 'starsGained') return b.starsGained - a.starsGained;
      return b.stars - a.stars;
    });
  };

  const formatNumber = (num) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">GitHub Trending</h2>
          <p className="text-gray-500 text-sm">
            Discover the most popular repositories right now
            {fetchedAt && (
              <span className="text-gray-400">
                {' '}(as of {fetchedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Sort by:</span>
          <button
            onClick={() => setSortBy('starsGained')}
            className={`px-3 py-1 rounded-l-lg border transition-colors ${
              sortBy === 'starsGained'
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Stars Added
          </button>
          <button
            onClick={() => setSortBy('stars')}
            className={`px-3 py-1 rounded-r-lg border-t border-r border-b -ml-px transition-colors ${
              sortBy === 'stars'
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Total Stars
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {PERIODS.map(({ key, label }) => {
          const { repos, loading, error } = trendingData[key];

          return (
            <div key={key} className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                <h3 className="font-semibold text-gray-900">{label}</h3>
              </div>

              <div className="p-4 max-h-[600px] overflow-y-auto">
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <svg className="w-6 h-6 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}

                {error && (
                  <div className="text-red-500 text-sm py-4 text-center">
                    Failed to load: {error}
                  </div>
                )}

                {!loading && !error && repos.length === 0 && (
                  <div className="text-gray-400 text-sm py-4 text-center">
                    No trending repos found
                  </div>
                )}

                {!loading && !error && repos.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 text-xs">
                        <th className="pb-2 font-medium">#</th>
                        <th className="pb-2 font-medium">Repository</th>
                        <th className="pb-2 font-medium text-right">Stars</th>
                        <th className="pb-2 font-medium text-right">New</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getSortedRepos(repos).slice(0, 15).map((repo, index) => (
                        <tr key={repo.fullName} className="border-t border-gray-100">
                          <td className="py-1.5 text-gray-400">{index + 1}</td>
                          <td className="py-1.5">
                            <a
                              href={`https://github.com/${repo.fullName}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline truncate block max-w-[180px]"
                              title={repo.fullName}
                            >
                              {repo.fullName}
                            </a>
                          </td>
                          <td className="py-1.5 text-right text-gray-600">{formatNumber(repo.stars)}</td>
                          <td className="py-1.5 text-right text-green-600 font-medium">+{formatNumber(repo.starsGained)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
