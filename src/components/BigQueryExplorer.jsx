import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function BigQueryExplorer() {
  const [presets, setPresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState('commits_over_time');
  const [customSql, setCustomSql] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [chartType, setChartType] = useState('line'); // 'line', 'table'

  useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = async () => {
    try {
      const response = await fetch('/api/bigquery');
      const data = await response.json();
      setPresets(data.presets || []);
    } catch (err) {
      console.error('Error loading presets:', err);
    }
  };

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body = useCustom
        ? { customSql }
        : { preset: selectedPreset };

      const response = await fetch('/api/bigquery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Query failed');
      }

      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num) => {
    if (num === null || num === undefined) return '-';
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const getChartData = () => {
    if (!result?.rows) return [];
    return result.rows;
  };

  const getNumericColumns = () => {
    if (!result?.rows?.length) return [];
    const firstRow = result.rows[0];
    return Object.keys(firstRow).filter(key => {
      const val = firstRow[key];
      return typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val)));
    });
  };

  const getXAxisKey = () => {
    if (!result?.rows?.length) return null;
    const keys = Object.keys(result.rows[0]);
    // Prefer date/month/time columns for X axis
    const dateKey = keys.find(k =>
      k.toLowerCase().includes('date') ||
      k.toLowerCase().includes('month') ||
      k.toLowerCase().includes('time') ||
      k.toLowerCase() === 'year'
    );
    return dateKey || keys[0];
  };

  const selectedPresetInfo = presets.find(p => p.key === selectedPreset);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
            <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
            <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z" />
          </svg>
          GitHub Archive Explorer
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Query GitHub's public event data from 2011 to present via BigQuery
        </p>
      </div>

      {/* Query Controls */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-6">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={!useCustom}
                onChange={() => setUseCustom(false)}
                className="text-blue-600"
              />
              <span className="text-sm font-medium text-gray-700">Preset Query</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={useCustom}
                onChange={() => setUseCustom(true)}
                className="text-blue-600"
              />
              <span className="text-sm font-medium text-gray-700">Custom SQL</span>
            </label>
          </div>

          {!useCustom ? (
            <div>
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%236b7280%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.293%207.293a1%201%200%20011.414%200L10%2010.586l3.293-3.293a1%201%200%20111.414%201.414l-4%204a1%201%200%2001-1.414%200l-4-4a1%201%200%20010-1.414z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center]"
              >
                {presets.map(preset => (
                  <option key={preset.key} value={preset.key}>
                    {preset.name}
                  </option>
                ))}
              </select>
              {selectedPresetInfo && (
                <p className="text-xs text-gray-500 mt-2">{selectedPresetInfo.description}</p>
              )}
            </div>
          ) : (
            <div>
              <textarea
                value={customSql}
                onChange={(e) => setCustomSql(e.target.value)}
                placeholder="SELECT ... FROM `githubarchive.month.*` WHERE ..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 h-32"
              />
              <p className="text-xs text-gray-500 mt-2">
                Query must be a SELECT on githubarchive.* or github_repos.* datasets
              </p>
            </div>
          )}
        </div>

        <div className="p-4 bg-gray-50 rounded-b-lg flex items-center justify-between">
          <button
            onClick={runQuery}
            disabled={loading || (useCustom && !customSql.trim())}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Running...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Run Query
              </>
            )}
          </button>

          {result && (
            <div className="text-sm text-gray-500">
              {formatNumber(result.rowCount)} rows in {(result.elapsedMs / 1000).toFixed(2)}s
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && result.rows?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          {/* View Toggle */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Results</h2>
            <div className="flex">
              <button
                onClick={() => setChartType('line')}
                className={`px-3 py-1 text-sm font-medium border-y border-l rounded-l ${
                  chartType === 'line'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Chart
              </button>
              <button
                onClick={() => setChartType('table')}
                className={`px-3 py-1 text-sm font-medium border rounded-r ${
                  chartType === 'table'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Table
              </button>
            </div>
          </div>

          {/* Chart View */}
          {chartType === 'line' && (
            <div className="p-4">
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={getChartData()} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey={getXAxisKey()}
                      tick={{ fontSize: 11 }}
                      tickLine={{ stroke: '#9ca3af' }}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={{ stroke: '#9ca3af' }}
                      tickFormatter={formatNumber}
                    />
                    <Tooltip
                      formatter={(value) => formatNumber(value)}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Legend />
                    {getNumericColumns()
                      .filter(col => col !== getXAxisKey())
                      .slice(0, 6)
                      .map((col, idx) => (
                        <Line
                          key={col}
                          type="monotone"
                          dataKey={col}
                          stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Table View */}
          {chartType === 'table' && (
            <div className="p-4 overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-gray-500 border-b">
                    {result.rows[0] && Object.keys(result.rows[0]).map(key => (
                      <th key={key} className="pb-2 pr-4 font-medium">{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 500).map((row, idx) => (
                    <tr key={idx} className="border-b border-gray-100">
                      {Object.values(row).map((val, vidx) => (
                        <td key={vidx} className="py-2 pr-4 text-gray-700">
                          {typeof val === 'number' ? formatNumber(val) : String(val ?? '-')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 500 && (
                <p className="text-xs text-gray-500 mt-2">Showing first 500 of {result.rowCount} rows</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Setup Instructions */}
      {!result && !loading && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-800 mb-2">Setup Required</h3>
          <p className="text-sm text-blue-700 mb-3">
            To use this feature, you need to configure Google Cloud credentials:
          </p>
          <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
            <li>Create a Google Cloud project at <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline">console.cloud.google.com</a></li>
            <li>Enable the BigQuery API</li>
            <li>Create a service account with BigQuery Job User and Data Viewer roles</li>
            <li>Download the JSON key file</li>
            <li>Add the JSON contents as <code className="bg-blue-100 px-1 rounded">GOOGLE_CLOUD_CREDENTIALS</code> env var in Vercel</li>
          </ol>
        </div>
      )}
    </div>
  );
}
