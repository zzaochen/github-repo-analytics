import { useState, useEffect } from 'react';
import { createGitHubClient } from '../services/githubApi';

export default function RateLimitStatus({ token }) {
  const [rateLimit, setRateLimit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRateLimit = async () => {
    if (!token) {
      setRateLimit(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const octokit = createGitHubClient(token);
      const { data } = await octokit.rest.rateLimit.get();
      setRateLimit(data.resources.core);
    } catch (err) {
      console.error('Error fetching rate limit:', err);
      setError('Failed to fetch');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRateLimit();
    // Refresh every 30 seconds
    const interval = setInterval(fetchRateLimit, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const formatResetTime = (resetTimestamp) => {
    const resetDate = new Date(resetTimestamp * 1000);
    const now = new Date();
    const diffMs = resetDate - now;

    if (diffMs <= 0) return 'now';

    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);

    if (diffMins > 0) {
      return `${diffMins}m ${diffSecs}s`;
    }
    return `${diffSecs}s`;
  };

  if (!token) return null;

  const usagePercent = rateLimit ? ((rateLimit.limit - rateLimit.remaining) / rateLimit.limit) * 100 : 0;
  const isLow = rateLimit && rateLimit.remaining < 100;
  const isDepleted = rateLimit && rateLimit.remaining === 0;

  return (
    <div className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-200">
      <div className="flex items-center justify-between mb-1">
        <span>API Rate Limit</span>
        <button
          onClick={fetchRateLimit}
          disabled={loading}
          className="text-gray-400 hover:text-gray-600"
          title="Refresh"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {error && <p className="text-red-500">{error}</p>}

      {rateLimit && (
        <>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  isDepleted ? 'bg-red-500' : isLow ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${100 - usagePercent}%` }}
              />
            </div>
            <span className={`font-medium ${isDepleted ? 'text-red-600' : isLow ? 'text-yellow-600' : 'text-gray-600'}`}>
              {rateLimit.remaining}/{rateLimit.limit}
            </span>
          </div>

          {(isLow || isDepleted) && (
            <p className={`mt-1 ${isDepleted ? 'text-red-600' : 'text-yellow-600'}`}>
              Resets in {formatResetTime(rateLimit.reset)}
            </p>
          )}
        </>
      )}

      {loading && !rateLimit && <p>Loading...</p>}
    </div>
  );
}
