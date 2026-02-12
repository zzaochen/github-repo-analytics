import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

// Map from CompareView metric keys to MoM metric keys
const METRIC_MAP = {
  totalStars: { label: 'Stars', changeKey: 'starsMomChange', pctKey: 'starsMomGrowthPct' },
  totalForks: { label: 'Forks', changeKey: 'forksMomChange', pctKey: 'forksMomGrowthPct' },
  totalIssuesOpened: { label: 'Issues Opened', changeKey: 'issuesOpenedMomChange', pctKey: 'issuesOpenedMomGrowthPct' },
  totalIssuesClosed: { label: 'Issues Closed', changeKey: 'issuesClosedMomChange', pctKey: 'issuesClosedMomGrowthPct' },
  totalPRsOpened: { label: 'PRs Opened', changeKey: 'prsOpenedMomChange', pctKey: 'prsOpenedMomGrowthPct' },
  totalPRsClosed: { label: 'PRs Closed', changeKey: 'prsOpenedMomChange', pctKey: 'prsOpenedMomGrowthPct' }, // Using opened as proxy
  totalPRsMerged: { label: 'PRs Merged', changeKey: 'prsMergedMomChange', pctKey: 'prsMergedMomGrowthPct' },
  totalContributors: { label: 'Contributors', changeKey: 'contributorsMomChange', pctKey: 'contributorsMomGrowthPct' },
};

const VIEW_MODES = [
  { key: 'percentage', label: 'Growth %' },
  { key: 'absolute', label: 'Absolute' },
];

const DATE_PRESETS = [
  { key: 'all', label: 'All' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: 'custom', label: 'Custom' },
];

export default function MoMGrowthChart({ selectedRepos, repoData, selectedMetric, datePreset, setDatePreset, startDate, setStartDate, endDate, setEndDate }) {
  const [valueMode, setValueMode] = useState('percentage'); // percentage or absolute
  const [timeMode, setTimeMode] = useState('date'); // date or indexed

  const currentMetric = METRIC_MAP[selectedMetric] || METRIC_MAP.totalStars;
  const dataKey = valueMode === 'percentage' ? currentMetric.pctKey : currentMetric.changeKey;

  // Build comparison data - merge all repos by month (date-based view)
  const getDateComparisonData = () => {
    if (selectedRepos.length === 0) return [];

    // Get all unique months across all repos
    const allMonths = new Set();
    selectedRepos.forEach(repoKey => {
      const data = repoData[repoKey] || [];
      data.forEach(d => allMonths.add(d.monthEnd));
    });

    // Sort months
    const sortedMonths = Array.from(allMonths).sort();

    // Build merged data
    return sortedMonths.map(month => {
      const point = { month };
      selectedRepos.forEach(repoKey => {
        const data = repoData[repoKey] || [];
        const monthData = data.find(d => d.monthEnd === month);
        if (monthData) {
          point[repoKey] = monthData[dataKey];
        }
      });
      return point;
    });
  };

  // Build indexed data where each repo starts at month 1
  const getIndexedComparisonData = () => {
    if (selectedRepos.length === 0) return [];

    // Find max length across all repos
    let maxLength = 0;
    selectedRepos.forEach(repoKey => {
      const data = repoData[repoKey] || [];
      if (data.length > maxLength) maxLength = data.length;
    });

    // Build indexed data (1-based since you need 1 month of data for MoM)
    const indexedData = [];
    for (let i = 0; i < maxLength; i++) {
      const point = { monthIndex: i + 1 };
      selectedRepos.forEach(repoKey => {
        const data = repoData[repoKey] || [];
        if (i < data.length) {
          point[repoKey] = data[i][dataKey];
        }
      });
      indexedData.push(point);
    }

    return indexedData;
  };

  const comparisonData = timeMode === 'indexed' ? getIndexedComparisonData() : getDateComparisonData();

  const formatMonth = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };

  const formatMonthIndex = (index) => {
    return `${index}mo`;
  };

  const formatValue = (value) => {
    if (value === null || value === undefined) return 'N/A';
    if (valueMode === 'percentage') {
      return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
    }
    if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
  };

  const formatYAxis = (value) => {
    if (value === 0) return '--';
    const formatWithCommas = (num) => num.toLocaleString('en-US');
    if (valueMode === 'percentage') {
      if (value < 0) return `(${formatWithCommas(Math.abs(value))}%)`;
      return `${formatWithCommas(value)}%`;
    }
    if (value < 0) {
      return `(${formatWithCommas(Math.abs(value))})`;
    }
    return formatWithCommas(value);
  };

  // Calculate X-axis ticks (max 8)
  const getXAxisTicks = () => {
    if (timeMode === 'indexed') {
      // For indexed mode, start at 1 (need 1 month of data), increase increment if needed
      const maxMonths = comparisonData.length;
      let increment = 1;
      while (Math.ceil(maxMonths / increment) > 8) {
        increment += 1;
      }
      const ticks = [];
      for (let month = 1; month <= maxMonths; month += increment) {
        ticks.push(month);
      }
      return ticks;
    } else {
      // For date mode, show all months if <= 8, otherwise evenly spaced
      if (comparisonData.length <= 8) {
        return comparisonData.map(d => d.month);
      }
      const ticks = [];
      const step = (comparisonData.length - 1) / 7;
      for (let i = 0; i < 8; i++) {
        const index = Math.round(i * step);
        ticks.push(comparisonData[index].month);
      }
      return ticks;
    }
  };

  // Calculate dynamic Y-axis domain based on visible data with nice round increments
  const getYAxisDomain = () => {
    if (comparisonData.length === 0) return ['auto', 'auto'];

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

    if (min === Infinity || max === -Infinity) return ['auto', 'auto'];

    // Calculate nice round intervals for 5 intervals (6 ticks)
    const range = max - min || 1;
    const roughInterval = range / 5;

    // Find a nice round interval
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval || 1)));
    const residual = roughInterval / magnitude;

    let niceInterval;
    if (residual <= 1) niceInterval = magnitude;
    else if (residual <= 2) niceInterval = 2 * magnitude;
    else if (residual <= 5) niceInterval = 5 * magnitude;
    else niceInterval = 10 * magnitude;

    // Round min down and max up to nearest interval
    const domainMin = Math.floor(min / niceInterval) * niceInterval;
    const domainMax = Math.ceil(max / niceInterval) * niceInterval;

    return [domainMin, domainMax];
  };

  if (selectedRepos.length === 0 || comparisonData.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      {/* Header with controls */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex-shrink-0">
          {currentMetric?.label} MoM Growth
        </h3>

        <div className="flex items-center gap-2">
          {/* Date Range Selection */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {DATE_PRESETS.map(preset => (
              <button
                key={preset.key}
                onClick={() => setDatePreset(preset.key)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  datePreset === preset.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {datePreset === 'custom' && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-1.5 py-1 bg-white border border-gray-300 rounded text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-gray-400 text-xs">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-1.5 py-1 bg-white border border-gray-300 rounded text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Time mode toggle (Date / Indexed) */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setTimeMode('date')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                timeMode === 'date'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Date
            </button>
            <button
              onClick={() => setTimeMode('indexed')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                timeMode === 'indexed'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Indexed
            </button>
          </div>

          {/* Value mode toggle (Growth % / Absolute) */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {VIEW_MODES.map(mode => (
              <button
                key={mode.key}
                onClick={() => setValueMode(mode.key)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  valueMode === mode.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: 400 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={comparisonData} key={`${datePreset}-${startDate}-${endDate}`}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey={timeMode === 'indexed' ? 'monthIndex' : 'month'}
              tickFormatter={timeMode === 'indexed' ? formatMonthIndex : formatMonth}
              tick={{ fill: '#6B7280', fontSize: 11 }}
              ticks={getXAxisTicks()}
            />
            <YAxis
              domain={getYAxisDomain()}
              allowDataOverflow={true}
              tickCount={6}
              tickFormatter={formatYAxis}
              tick={{ fill: '#6B7280', fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px'
              }}
              labelFormatter={(label) => {
                if (timeMode === 'indexed') {
                  return `Month ${label}`;
                }
                return formatMonth(label);
              }}
              formatter={(value, name) => [formatValue(value), name]}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" />
            {selectedRepos.map((repoKey, index) => (
              <Line
                key={repoKey}
                type="monotone"
                dataKey={repoKey}
                name={repoKey}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
