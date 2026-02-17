import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTrendingRepos } from '../services/trendingScraper';
import { getCachedRepos, getRecentlyAddedRepos, getAggregateStats } from '../services/supabase';

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

  // Recently added repos
  const [recentlyAdded, setRecentlyAdded] = useState([]);

  // Aggregate stats
  const [aggregateStats, setAggregateStats] = useState(null);
  const [statsDateFilter, setStatsDateFilter] = useState('all'); // 'all', '7d', '30d', '90d', '1y', 'custom'
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });
  const [statsLoading, setStatsLoading] = useState(false);

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

  // Load recently added repos (last 48 hours)
  useEffect(() => {
    getRecentlyAddedRepos(48).then(setRecentlyAdded);
  }, []);

  // Load aggregate stats with date filter
  useEffect(() => {
    const loadStats = async () => {
      setStatsLoading(true);
      let dateFilter = null;

      if (statsDateFilter !== 'all') {
        const endDate = new Date().toISOString().split('T')[0];
        let startDate;

        if (statsDateFilter === '7d') {
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        } else if (statsDateFilter === '30d') {
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        } else if (statsDateFilter === '90d') {
          startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        } else if (statsDateFilter === '1y') {
          startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        } else if (statsDateFilter === 'custom' && customDateRange.start && customDateRange.end) {
          startDate = customDateRange.start;
          dateFilter = { startDate, endDate: customDateRange.end };
        }

        if (statsDateFilter !== 'custom' && startDate) {
          dateFilter = { startDate, endDate };
        }
      }

      const stats = await getAggregateStats(dateFilter);
      setAggregateStats(stats);
      setStatsLoading(false);
    };

    loadStats();
  }, [statsDateFilter, customDateRange.start, customDateRange.end]);

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
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2 flex items-center justify-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            Repo Search
          </h2>
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
          <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-orange-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
            </svg>
            GitHub Trending
          </h2>
          <p className="text-gray-500 text-sm">
            Discover the most popular repositories right now
            {fetchedAt && (
              <span className="text-gray-500">
                {' '}(as of {fetchedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center text-sm">
          <span className="text-gray-500 mr-2">Sort by:</span>
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
            className={`px-3 py-1 border-t border-r border-b border-l border-l-gray-200 -ml-px transition-colors ${
              sortBy === 'percentChange'
                ? 'bg-blue-500 text-white border-blue-500 border-l-gray-200'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            % Change
          </button>
          <button
            onClick={() => setSortBy('stars')}
            className={`px-3 py-1 rounded-r-lg border-t border-r border-b border-l border-l-gray-200 -ml-px transition-colors ${
              sortBy === 'stars'
                ? 'bg-blue-500 text-white border-blue-500 border-l-gray-200'
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
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 text-xs">
                        <th className="pb-2 font-medium w-6">#</th>
                        <th className="pb-2 font-medium">Repository</th>
                        <th className="pb-2 font-medium text-right w-14">Stars</th>
                        <th className="pb-2 font-medium text-right w-14">New</th>
                        <th className="pb-2 font-medium text-right w-14">%</th>
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
                              ? `+${Math.round((repo.starsGained / (repo.stars - repo.starsGained)) * 100).toLocaleString('en-US')}%`
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

      {/* Recently Added Repos and Stats Summary */}
      {(recentlyAdded.length > 0 || aggregateStats) && (() => {
        // Create a map of trending repos for quick lookup (combine all periods)
        const trendingMap = new Map();
        ['daily', 'weekly', 'monthly'].forEach(period => {
          (trendingData[period]?.repos || []).forEach(repo => {
            if (!trendingMap.has(repo.fullName) || trendingMap.get(repo.fullName).starsGained < repo.starsGained) {
              trendingMap.set(repo.fullName, repo);
            }
          });
        });

        // Enrich recently added with trending data
        const enrichedRepos = recentlyAdded.map(repo => {
          const fullName = `${repo.owner}/${repo.repo}`;
          const trendingInfo = trendingMap.get(fullName);
          return {
            ...repo,
            fullName,
            stars: trendingInfo?.stars || 0,
            starsGained: trendingInfo?.starsGained || 0
          };
        });

        // Sort using the same logic as trending tables
        const sortedRepos = [...enrichedRepos].sort((a, b) => {
          if (sortBy === 'starsGained') return b.starsGained - a.starsGained;
          if (sortBy === 'percentChange') {
            const pctA = a.stars > a.starsGained ? (a.starsGained / (a.stars - a.starsGained)) * 100 : Infinity;
            const pctB = b.stars > b.starsGained ? (b.starsGained / (b.stars - b.starsGained)) * 100 : Infinity;
            return pctB - pctA;
          }
          return b.stars - a.stars;
        });

        return (
          <div className="mt-8 flex gap-6">
            {/* Recently Added Table */}
            {recentlyAdded.length > 0 && (
              <div className="w-1/2">
                <div className="mb-4">
                  <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                    </svg>
                    Recently Added
                  </h2>
                  <p className="text-gray-500 text-sm">New repos added from trending in the last 48 hours</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                    <h3 className="font-semibold text-gray-900">{recentlyAdded.length} New Repos</h3>
                  </div>
                  <div className="p-4 max-h-[400px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 text-xs whitespace-nowrap">
                          <th className="pb-2 font-medium w-6">#</th>
                          <th className="pb-2 font-medium">Repository</th>
                          <th className="pb-2 font-medium text-right w-16">Stars</th>
                          <th className="pb-2 font-medium text-right w-16">New</th>
                          <th className="pb-2 font-medium text-right w-16">%</th>
                          <th className="pb-2 font-medium text-right w-16">Added</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRepos.map((repo, index) => (
                          <tr key={repo.id} className="border-t border-gray-100 whitespace-nowrap">
                            <td className="py-1.5 text-gray-400">{index + 1}</td>
                            <td className="py-1.5">
                              <a
                                href={`https://github.com/${repo.fullName}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline truncate block max-w-[140px]"
                                title={repo.fullName}
                              >
                                {repo.fullName}
                              </a>
                            </td>
                            <td className="py-1.5 text-right text-gray-600">
                              {repo.stars ? formatNumber(repo.stars) : '-'}
                            </td>
                            <td className="py-1.5 text-right text-green-600 font-medium">
                              {repo.starsGained ? `+${formatNumber(repo.starsGained)}` : '-'}
                            </td>
                            <td className="py-1.5 text-right text-green-600 font-medium">
                              {repo.stars && repo.starsGained && repo.stars > repo.starsGained
                                ? `+${Math.round((repo.starsGained / (repo.stars - repo.starsGained)) * 100).toLocaleString('en-US')}%`
                                : repo.starsGained ? 'New' : '-'}
                            </td>
                            <td className="py-1.5 text-right text-gray-500">
                              {new Date(repo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Stats Summary */}
            {(aggregateStats || statsLoading) && (
              <div className="w-1/2">
                <div className="mb-4">
                  <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                    </svg>
                    All Repo Stats
                  </h2>
                  <p className="text-gray-500 text-sm">Aggregate stats across all cached repositories</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
                  {/* Date Filter Controls */}
                  <div className="mb-4 pb-3 border-b border-gray-200">
                    <div className="flex items-center justify-end">
                      <div className="flex">
                        {[
                          { key: 'all', label: 'All' },
                          { key: '7d', label: '1W' },
                          { key: '30d', label: '1M' },
                          { key: '90d', label: '3M' },
                          { key: '1y', label: '1Y' },
                          { key: 'custom', label: 'Custom' }
                        ].map(({ key, label }, index, arr) => (
                          <button
                            key={key}
                            onClick={() => setStatsDateFilter(key)}
                            className={`px-1.5 py-0.5 text-[10px] border-y border-r transition-colors ${
                              index === 0 ? 'border-l rounded-l' : ''
                            } ${
                              index === arr.length - 1 ? 'rounded-r' : ''
                            } ${
                              statsDateFilter === key
                                ? 'bg-blue-500 text-white border-blue-500'
                                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {statsDateFilter === 'custom' && (
                        <div className="flex items-center ml-2">
                          <input
                            type="date"
                            value={customDateRange.start}
                            onChange={(e) => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))}
                            className="px-1 py-0.5 text-[10px] border border-gray-300 rounded-l focus:outline-none focus:ring-1 focus:ring-blue-500 w-24"
                          />
                          <input
                            type="date"
                            value={customDateRange.end}
                            onChange={(e) => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))}
                            className="px-1 py-0.5 text-[10px] border-y border-r border-gray-300 rounded-r focus:outline-none focus:ring-1 focus:ring-blue-500 w-24 -ml-px"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {statsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <svg className="w-6 h-6 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  ) : aggregateStats && (
                    <>
                      <div className="space-y-1">
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="text-xs text-gray-600">Total Repos Cached</span>
                          <span className="text-xs font-bold text-gray-900">{aggregateStats.totalRepos.toLocaleString('en-US')}</span>
                        </div>
                        {aggregateStats.reposWithData !== undefined && aggregateStats.reposWithData !== aggregateStats.totalRepos && (
                          <div className="flex justify-between items-center py-1 border-b border-gray-100">
                            <span className="text-xs text-gray-600">Repos with Data in Range</span>
                            <span className="text-xs font-bold text-gray-900">{aggregateStats.reposWithData.toLocaleString('en-US')}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="text-xs text-gray-600">Total Stars</span>
                          <span className="text-xs font-bold text-gray-900">{aggregateStats.totalStars.toLocaleString('en-US')}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="text-xs text-gray-600">Total Forks</span>
                          <span className="text-xs font-bold text-gray-900">{aggregateStats.totalForks.toLocaleString('en-US')}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="text-xs text-gray-600">Total Contributors</span>
                          <span className="text-xs font-bold text-gray-900">{aggregateStats.totalContributors.toLocaleString('en-US')}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="text-xs text-gray-600">Total PRs Opened</span>
                          <span className="text-xs font-bold text-gray-900">{aggregateStats.totalPRsOpened.toLocaleString('en-US')}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="text-xs text-gray-600">Total PRs Merged</span>
                          <span className="text-xs font-bold text-gray-900">{aggregateStats.totalPRsMerged.toLocaleString('en-US')}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs text-gray-600">Total PRs Closed</span>
                          <span className="text-xs font-bold text-gray-900">{aggregateStats.totalPRsClosed.toLocaleString('en-US')}</span>
                        </div>
                      </div>
                      <p className="text-gray-400 text-xs italic mt-3">
                        {statsDateFilter !== 'all' && aggregateStats.dateFilter ? (
                          <>Data from {aggregateStats.dateFilter.startDate} to {aggregateStats.dateFilter.endDate}</>
                        ) : (
                          <>As of {new Date(aggregateStats.asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                        )}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
