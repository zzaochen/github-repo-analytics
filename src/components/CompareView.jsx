import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getCachedRepos, getRepoFromCache, transformCachedMetrics, getMonthlyMetricsForRepos } from '../services/supabase';
import MoMGrowthChart from './MoMGrowthChart';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const METRICS = [
  { key: 'totalStars', label: 'Stars' },
  { key: 'totalForks', label: 'Forks' },
  { key: 'totalIssuesOpened', label: 'Issues Opened' },
  { key: 'totalIssuesClosed', label: 'Issues Closed' },
  { key: 'totalPRsOpened', label: 'PRs Opened' },
  { key: 'totalPRsClosed', label: 'PRs Closed' },
  { key: 'totalPRsMerged', label: 'PRs Merged' },
  { key: 'totalContributors', label: 'Contributors' },
];

const DATE_PRESETS = [
  { key: 'all', label: 'All' },
  { key: '1w', label: '1W' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: 'custom', label: 'Custom' },
];

export default function CompareView() {
  const [cachedRepos, setCachedRepos] = useState([]);
  const [selectedRepos, setSelectedRepos] = useState([]);
  const [repoData, setRepoData] = useState({});
  const [monthlyData, setMonthlyData] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState('totalStars');
  const [viewMode, setViewMode] = useState('date'); // 'date' or 'indexed'
  const [repoSearchTerm, setRepoSearchTerm] = useState('');
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);
  // Date range state for metrics chart
  const [metricsDatePreset, setMetricsDatePreset] = useState('all');
  const [metricsStartDate, setMetricsStartDate] = useState('');
  const [metricsEndDate, setMetricsEndDate] = useState('');
  // Date range state for MoM chart
  const [momDatePreset, setMomDatePreset] = useState('all');
  const [momStartDate, setMomStartDate] = useState('');
  const [momEndDate, setMomEndDate] = useState('');
  const repoSearchRef = useRef(null);

  useEffect(() => {
    loadCachedRepos();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (repoSearchRef.current && !repoSearchRef.current.contains(e.target)) {
        setIsRepoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadCachedRepos = async () => {
    setLoading(true);
    const repos = await getCachedRepos();
    setCachedRepos(repos);
    setLoading(false);
  };

  const handleRepoToggle = async (repo) => {
    const repoKey = `${repo.owner}/${repo.repo}`;

    if (selectedRepos.includes(repoKey)) {
      // Remove repo
      setSelectedRepos(prev => prev.filter(r => r !== repoKey));
      setRepoData(prev => {
        const newData = { ...prev };
        delete newData[repoKey];
        return newData;
      });
      setMonthlyData(prev => {
        const newData = { ...prev };
        delete newData[repoKey];
        return newData;
      });
    } else {
      // Add repo
      const newSelectedRepos = [...selectedRepos, repoKey];
      setSelectedRepos(newSelectedRepos);

      // Load daily data if not already loaded
      if (!repoData[repoKey]) {
        setLoadingData(true);
        const cached = await getRepoFromCache(repo.owner, repo.repo);
        if (cached && cached.metrics.length > 0) {
          const transformed = transformCachedMetrics(cached.metrics);
          setRepoData(prev => ({ ...prev, [repoKey]: transformed }));
        }
        setLoadingData(false);
      }

      // Load monthly data
      const monthlyResult = await getMonthlyMetricsForRepos([repoKey]);
      if (monthlyResult[repoKey]) {
        setMonthlyData(prev => ({ ...prev, [repoKey]: monthlyResult[repoKey] }));
      }
    }
  };

  // Calculate date range based on preset or custom dates
  const getDateRange = (preset, customStart, customEnd) => {
    const today = new Date();
    let start = null;
    let end = today.toISOString().split('T')[0];

    switch (preset) {
      case '1w':
        start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7).toISOString().split('T')[0];
        break;
      case '1m':
        start = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate()).toISOString().split('T')[0];
        break;
      case '3m':
        start = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()).toISOString().split('T')[0];
        break;
      case '6m':
        start = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate()).toISOString().split('T')[0];
        break;
      case '1y':
        start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().split('T')[0];
        break;
      case 'custom':
        start = customStart || null;
        end = customEnd || today.toISOString().split('T')[0];
        break;
      case 'all':
      default:
        start = null;
        end = null;
        break;
    }

    return { start, end };
  };

  // Filter data by date range
  const filterDataByDateRange = (data, dateField, preset, customStart, customEnd) => {
    const { start, end } = getDateRange(preset, customStart, customEnd);
    if (!start && !end) return data;

    return data.filter(item => {
      const itemDate = item[dateField];
      if (start && itemDate < start) return false;
      if (end && itemDate > end) return false;
      return true;
    });
  };

  // Get filtered repo data (for metrics chart)
  const getFilteredRepoData = () => {
    const filtered = {};
    selectedRepos.forEach(repoKey => {
      const data = repoData[repoKey] || [];
      filtered[repoKey] = filterDataByDateRange(data, 'date', metricsDatePreset, metricsStartDate, metricsEndDate);
    });
    return filtered;
  };

  // Get filtered monthly data (for MoM chart)
  const getFilteredMonthlyData = () => {
    const filtered = {};
    selectedRepos.forEach(repoKey => {
      const data = monthlyData[repoKey] || [];
      filtered[repoKey] = filterDataByDateRange(data, 'monthEnd', momDatePreset, momStartDate, momEndDate);
    });
    return filtered;
  };

  const filteredRepoData = getFilteredRepoData();
  const filteredMonthlyData = getFilteredMonthlyData();

  // Merge data from all selected repos for the chart (date-based view)
  const getDateComparisonData = () => {
    if (selectedRepos.length === 0) return [];

    // Get all unique dates across all repos
    const allDates = new Set();
    selectedRepos.forEach(repoKey => {
      const data = filteredRepoData[repoKey] || [];
      data.forEach(d => allDates.add(d.date));
    });

    // Sort dates
    const sortedDates = Array.from(allDates).sort();

    // Build merged data with timestamp for proper time-based spacing
    return sortedDates.map(date => {
      const point = {
        date,
        timestamp: new Date(date).getTime()
      };
      selectedRepos.forEach(repoKey => {
        const data = filteredRepoData[repoKey] || [];
        const dayData = data.find(d => d.date === date);
        if (dayData) {
          point[repoKey] = dayData[selectedMetric] || 0;
        }
      });
      return point;
    });
  };

  // Build indexed data where each repo starts at day 0
  const getIndexedComparisonData = () => {
    if (selectedRepos.length === 0) return [];

    // Find max length across all repos
    let maxLength = 0;
    selectedRepos.forEach(repoKey => {
      const data = filteredRepoData[repoKey] || [];
      if (data.length > maxLength) maxLength = data.length;
    });

    // Build indexed data
    const indexedData = [];
    for (let i = 0; i < maxLength; i++) {
      const point = { dayIndex: i };
      selectedRepos.forEach(repoKey => {
        const data = filteredRepoData[repoKey] || [];
        if (i < data.length) {
          point[repoKey] = data[i][selectedMetric] || 0;
        }
      });
      indexedData.push(point);
    }

    return indexedData;
  };

  const comparisonData = viewMode === 'indexed' ? getIndexedComparisonData() : getDateComparisonData();

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDayIndex = (index) => {
    const months = Math.floor(index / 30);
    return `${months}mo`;
  };

  // Calculate tick indices with month-aligned spacing
  const getXAxisTicks = () => {
    if (comparisonData.length === 0) return [];

    const [domainMin, domainMax] = getXAxisDomain();

    if (viewMode === 'indexed') {
      // For indexed mode, show months in multiples of 3, max 8 ticks
      const maxDays = domainMax;
      const totalMonths = Math.ceil(maxDays / 30);

      // Find increment (multiple of 3) that gives us <= 8 ticks
      let increment = 3;
      while (Math.floor(totalMonths / increment) + 1 > 8) {
        increment += 3;
      }

      const ticks = [];
      for (let month = 0; month * 30 <= maxDays; month += increment) {
        ticks.push(month * 30);
      }
      return ticks;
    } else {
      // For date mode, generate month-aligned ticks
      const startDate = new Date(domainMin);
      const endDate = new Date(domainMax);

      // Calculate total months in range
      const totalMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12
        + (endDate.getMonth() - startDate.getMonth());

      // Determine month increment (1, 2, 3, or 6 months)
      let monthIncrement = 1;
      if (totalMonths > 24) monthIncrement = 6;
      else if (totalMonths > 12) monthIncrement = 3;
      else if (totalMonths > 6) monthIncrement = 2;

      const ticks = [];
      // Start from the first day of the start month
      const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

      while (current.getTime() <= domainMax) {
        ticks.push(current.getTime());
        current.setMonth(current.getMonth() + monthIncrement);
      }

      // Always include the end point
      if (ticks[ticks.length - 1] < domainMax) {
        ticks.push(domainMax);
      }

      return ticks;
    }
  };

  // Get X-axis domain - use full selected date range for date mode
  const getXAxisDomain = () => {
    if (comparisonData.length === 0) return [0, 1];

    if (viewMode === 'indexed') {
      // For indexed mode, domain is 0 to max day index
      return [0, comparisonData.length - 1];
    }

    // Get the selected date range
    const { start, end } = getDateRange(metricsDatePreset, metricsStartDate, metricsEndDate);
    const today = new Date();

    // Use selected range or fall back to data range
    let minTime, maxTime;

    if (start) {
      minTime = new Date(start).getTime();
    } else {
      // For 'all', use data min
      const timestamps = comparisonData.map(d => d.timestamp);
      minTime = Math.min(...timestamps);
    }

    if (end) {
      maxTime = new Date(end).getTime();
    } else {
      // Use today as the end
      maxTime = today.getTime();
    }

    return [minTime, maxTime];
  };

  const formatNumber = (num) => {
    if (num === 0) return '--';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num?.toString() || '--';
  };

  // Calculate dynamic Y-axis domain based on visible data with nice round increments
  const getYAxisDomain = () => {
    if (comparisonData.length === 0) return [0, 'auto'];

    let min = Infinity;
    let max = -Infinity;

    comparisonData.forEach(point => {
      selectedRepos.forEach(repoKey => {
        const value = point[repoKey];
        if (value !== undefined && value !== null) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      });
    });

    if (min === Infinity || max === -Infinity) return [0, 'auto'];

    // Calculate nice round intervals for 5 intervals (6 ticks)
    const range = max - min || 1;
    const roughInterval = range / 5;

    // Find a nice round interval
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
    const residual = roughInterval / magnitude;

    let niceInterval;
    if (residual <= 1) niceInterval = magnitude;
    else if (residual <= 2) niceInterval = 2 * magnitude;
    else if (residual <= 5) niceInterval = 5 * magnitude;
    else niceInterval = 10 * magnitude;

    // Round min down and max up to nearest interval, but never below 0
    const domainMin = Math.max(0, Math.floor(min / niceInterval) * niceInterval);
    const domainMax = Math.ceil(max / niceInterval) * niceInterval;

    return [domainMin, domainMax];
  };

  if (loading) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p>Loading cached repositories...</p>
      </div>
    );
  }

  if (cachedRepos.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p className="text-lg">No cached repositories available</p>
        <p className="text-sm mt-1">Analyze some repositories first using the Repo Data view</p>
      </div>
    );
  }

  return (
    <div>
      {/* Repo and Metric Selection */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
        <div className="flex flex-wrap gap-4">
          {/* Repo Selection Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-2">Repositories</label>
            <div className="relative" ref={repoSearchRef}>
              <input
                type="text"
                value={repoSearchTerm}
                onChange={(e) => {
                  setRepoSearchTerm(e.target.value);
                  setIsRepoDropdownOpen(true);
                }}
                onFocus={() => setIsRepoDropdownOpen(true)}
                placeholder="Search to add..."
                className="w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>

              {isRepoDropdownOpen && (
                (() => {
                  const availableRepos = cachedRepos
                    .filter(repo => !selectedRepos.includes(`${repo.owner}/${repo.repo}`))
                    .filter(repo => {
                      const repoKey = `${repo.owner}/${repo.repo}`.toLowerCase();
                      return repoKey.includes(repoSearchTerm.toLowerCase());
                    });

                  if (availableRepos.length > 0) {
                    return (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {availableRepos.map((repo) => (
                          <button
                            key={repo.id}
                            onClick={() => {
                              handleRepoToggle(repo);
                              setRepoSearchTerm('');
                              setIsRepoDropdownOpen(false);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                          >
                            {repo.owner}/{repo.repo}
                          </button>
                        ))}
                      </div>
                    );
                  } else if (repoSearchTerm) {
                    return (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3">
                        <p className="text-sm text-gray-500">No repositories found</p>
                      </div>
                    );
                  }
                  return null;
                })()
              )}
            </div>
            {/* Selected repos tags */}
            {selectedRepos.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedRepos.map((repoKey, index) => (
                  <span
                    key={repoKey}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-white"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  >
                    {repoKey}
                    <button
                      onClick={() => {
                        const [owner, repo] = repoKey.split('/');
                        const repoObj = cachedRepos.find(r => r.owner === owner && r.repo === repo);
                        if (repoObj) handleRepoToggle(repoObj);
                      }}
                      className="ml-1 hover:bg-white/20 rounded"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
            {loadingData && (
              <p className="text-sm text-gray-500 mt-2">Loading repository data...</p>
            )}
          </div>

          {/* Metric Selection Dropdown */}
          <div className="min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 mb-2">Metric</label>
            <div className="relative">
              <select
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
                className="w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
              >
                {METRICS.map(metric => (
                  <option key={metric.key} value={metric.key}>
                    {metric.label}
                  </option>
                ))}
              </select>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

        </div>
      </div>

      {/* Comparison Chart */}
      {selectedRepos.length > 0 && comparisonData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {METRICS.find(m => m.key === selectedMetric)?.label} Comparison
            </h3>

            <div className="flex items-center gap-3">
              {/* Date Range Selection */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                {DATE_PRESETS.map(preset => (
                  <button
                    key={preset.key}
                    onClick={() => setMetricsDatePreset(preset.key)}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                      metricsDatePreset === preset.key
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {metricsDatePreset === 'custom' && (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={metricsStartDate}
                    onChange={(e) => setMetricsStartDate(e.target.value)}
                    className="px-1.5 py-1 bg-white border border-gray-300 rounded text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-gray-400 text-xs">to</span>
                  <input
                    type="date"
                    value={metricsEndDate}
                    onChange={(e) => setMetricsEndDate(e.target.value)}
                    className="px-1.5 py-1 bg-white border border-gray-300 rounded text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* View Mode Toggle */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('date')}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    viewMode === 'date'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Date
                </button>
                <button
                  onClick={() => setViewMode('indexed')}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    viewMode === 'indexed'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Indexed
                </button>
              </div>
            </div>
          </div>

          <div style={{ height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparisonData} key={`${metricsDatePreset}-${metricsStartDate}-${metricsEndDate}`}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey={viewMode === 'indexed' ? 'dayIndex' : 'timestamp'}
                  type="number"
                  domain={getXAxisDomain()}
                  tickFormatter={viewMode === 'indexed' ? formatDayIndex : (ts) => formatDate(new Date(ts).toISOString())}
                  tick={{ fill: '#6B7280', fontSize: 11 }}
                  ticks={getXAxisTicks()}
                  allowDataOverflow={true}
                />
                <YAxis
                  domain={getYAxisDomain()}
                  allowDataOverflow={true}
                  tickCount={6}
                  tickFormatter={formatNumber}
                  tick={{ fill: '#6B7280', fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px'
                  }}
                  labelFormatter={(label) => {
                    if (viewMode === 'indexed') {
                      const months = Math.floor(label / 30);
                      const days = label % 30;
                      if (months === 0) return `Day ${label}`;
                      if (days === 0) return `${months} month${months > 1 ? 's' : ''}`;
                      return `${months} month${months > 1 ? 's' : ''}, ${days} day${days > 1 ? 's' : ''}`;
                    }
                    // label is now a timestamp
                    return new Date(label).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    });
                  }}
                  formatter={(value, name) => [formatNumber(value), name]}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                {selectedRepos.map((repoKey, index) => (
                  <Line
                    key={repoKey}
                    type="monotone"
                    dataKey={repoKey}
                    name={repoKey}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* MoM Growth Chart */}
      {selectedRepos.length > 0 && (
        <div className="mt-6">
          <MoMGrowthChart
            selectedRepos={selectedRepos}
            repoData={filteredMonthlyData}
            selectedMetric={selectedMetric}
            datePreset={momDatePreset}
            setDatePreset={setMomDatePreset}
            startDate={momStartDate}
            setStartDate={setMomStartDate}
            endDate={momEndDate}
            setEndDate={setMomEndDate}
          />
        </div>
      )}

      {/* Empty state when repos selected but no data */}
      {selectedRepos.length > 0 && comparisonData.length === 0 && !loadingData && (
        <div className="text-center py-16 text-gray-500">
          <p>No data available for comparison</p>
        </div>
      )}

      {/* Initial empty state */}
      {selectedRepos.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-lg">Select repositories to compare</p>
          <p className="text-sm mt-1">Click on the repositories above to add them to the comparison</p>
        </div>
      )}
    </div>
  );
}
