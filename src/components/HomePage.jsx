import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTrendingRepos } from '../services/trendingScraper';
import { getCachedRepos } from '../services/supabase';

const PERIODS = [
  { key: 'daily', label: 'Daily Trending', param: 'daily' },
  { key: 'weekly', label: 'Weekly Trending', param: 'weekly' },
  { key: 'monthly', label: 'Monthly Trending', param: 'monthly' }
];

const CACHE_KEY = 'trending_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCache() {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_DURATION) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {}
}

export default function HomePage({ onRepoSelect, onOpenSidebar }) {
  const navigate = useNavigate();
  const [trendingData, setTrendingData] = useState({
    daily: { repos: [], loading: true, error: null },
    weekly: { repos: [], loading: true, error: null },
    monthly: { repos: [], loading: true, error: null }
  });
  const [sortBy, setSortBy] = useState('starsGained');
  const [fetchedAt, setFetchedAt] = useState(null);

  // Repo lookup dropdown state
  const [cachedRepos, setCachedRepos] = useState([]);
  const [repoSearchTerm, setRepoSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    // Check cache first
    const cached = getCache();
    if (cached) {
      setTrendingData(cached.trendingData);
      setFetchedAt(new Date(cached.fetchedAt));
      return;
    }

    // Fetch all three periods in parallel
    const fetchPromises = PERIODS.map(({ key, param }) =>
      fetchTrendingRepos(param)
        .then(repos => ({ key, repos, error: null }))
        .catch(err => ({ key, repos: [], error: err.message }))
    );

    Promise.all(fetchPromises).then(results => {
      const newData = { ...trendingData };
      results.forEach(({ key, repos, error }) => {
        newData[key] = { repos, loading: false, error };
      });
      setTrendingData(newData);
      const now = new Date();
      setFetchedAt(now);

      // Cache the results
      setCache({ trendingData: newData, fetchedAt: now.toISOString() });
    });
  }, []);

  // Load cached repos for dropdown
  useEffect(() => {
    getCachedRepos().then(setCachedRepos);
  }, []);

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex];
      if (item) item.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  // Reset highlight when search changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [repoSearchTerm]);

  const filteredRepos = cachedRepos
    .filter(repo => `${repo.owner}/${repo.repo}`.toLowerCase().includes(repoSearchTerm.toLowerCase()))
    .sort((a, b) => `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`));

  const handleRepoSelect = (repo) => {
    onRepoSelect(repo.owner, repo.repo);
    setRepoSearchTerm('');
    setIsDropdownOpen(false);
    setHighlightedIndex(-1);
    navigate('/lookup');
  };

  const handleKeyDown = (e) => {
    if (!isDropdownOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setIsDropdownOpen(true);
        setHighlightedIndex(0);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => prev < filteredRepos.length - 1 ? prev + 1 : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : filteredRepos.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredRepos.length) {
          handleRepoSelect(filteredRepos[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsDropdownOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  const getSortedRepos = (repos) => {
    return [...repos].sort((a, b) => {
      if (sortBy === 'starsGained') return b.starsGained - a.starsGained;
      if (sortBy === 'percentChange') {
        const pctA = a.stars > a.starsGained ? (a.starsGained / (a.stars - a.starsGained)) * 100 : Infinity;
        const pctB = b.stars > b.starsGained ? (b.starsGained / (b.stars - b.starsGained)) * 100 : Infinity;
        return pctB - pctA;
      }
      return b.stars - a.stars;
    });
  };

  const formatNumber = (num) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <div>
      {/* Repo Search */}
      {cachedRepos.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-12 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Repo Search</h2>
          <p className="text-gray-500 text-sm text-center mb-4">
            Look up a specific repo or if not cached, run a{' '}
            <button
              onClick={onOpenSidebar}
              className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
            >
              fetch
            </button>
          </p>
          <div className="relative" ref={dropdownRef}>
            <input
              type="text"
              value={repoSearchTerm}
              onChange={(e) => {
                setRepoSearchTerm(e.target.value);
                setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Search cached repositories..."
              className="w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>

            {isDropdownOpen && filteredRepos.length > 0 && (
              <div ref={listRef} className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredRepos.map((repo, index) => (
                  <button
                    key={repo.id}
                    onClick={() => handleRepoSelect(repo)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`w-full px-3 py-2 text-left text-sm text-gray-700 focus:outline-none ${
                      index === highlightedIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100'
                    }`}
                  >
                    {repo.owner}/{repo.repo}
                  </button>
                ))}
              </div>
            )}

            {isDropdownOpen && repoSearchTerm && filteredRepos.length === 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3">
                <p className="text-sm text-gray-500">No repositories found</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">GitHub Trending</h2>
          <p className="text-gray-500 text-sm">
            Discover the most popular repositories right now
            {fetchedAt && (
              <span className="text-gray-500">
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
            onClick={() => setSortBy('percentChange')}
            className={`px-3 py-1 border-t border-r border-b -ml-px transition-colors ${
              sortBy === 'percentChange'
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            % Change
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
                        <th className="pb-2 font-medium text-right">%</th>
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
                          <td className="py-1.5 text-right text-green-600 font-medium">
                            {repo.stars > repo.starsGained
                              ? `+${((repo.starsGained / (repo.stars - repo.starsGained)) * 100).toFixed(1)}%`
                              : 'New'}
                          </td>
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
