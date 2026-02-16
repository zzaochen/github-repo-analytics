export default function LoadingProgress({ progress }) {
  const { totals, stars, forks, issues, prs, commits, status, isRefresh, existingCounts } = progress;

  const getPercentage = (fetched, total) => {
    if (!total || total === 0) return null;
    return Math.min(100, Math.round((fetched / total) * 100));
  };

  const formatNumber = (num) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num?.toString() || '0';
  };

  const metrics = [
    { key: 'stars', label: isRefresh ? 'New Stars' : 'Stars', data: stars, total: totals?.stars },
    { key: 'forks', label: isRefresh ? 'New Forks' : 'Forks', data: forks, total: totals?.forks },
    { key: 'issues', label: 'Issues', data: issues, total: isRefresh ? null : totals?.issues },
    { key: 'prs', label: 'PRs', data: prs, total: null },
    { key: 'commits', label: 'Commits', data: commits, total: null },
  ];

  const activeMetrics = metrics.filter(m => m.data?.fetched > 0 || m.data?.rateLimit);

  // Calculate overall progress
  const overallProgress = (() => {
    let totalFetched = 0;
    let totalExpected = 0;

    if (stars?.fetched && totals?.stars) {
      totalFetched += stars.fetched;
      totalExpected += totals.stars;
    }
    if (forks?.fetched && totals?.forks) {
      totalFetched += forks.fetched;
      totalExpected += totals.forks;
    }

    if (totalExpected > 0) {
      return Math.min(100, Math.round((totalFetched / totalExpected) * 100));
    }
    return null;
  })();

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-blue-500 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span className="text-gray-700 font-medium">
          {isRefresh ? 'Updating Data' : 'Fetching Data'}
          {overallProgress !== null && (
            <span className="text-blue-600 ml-2">({overallProgress}%)</span>
          )}
        </span>
        {status && (
          <span className="text-gray-500 text-sm">— {status}</span>
        )}
      </div>

      {/* Show existing counts context for refresh */}
      {isRefresh && existingCounts && (
        <div className="text-sm text-gray-500 mb-3">
          Cached: {formatNumber(existingCounts.stars)} stars, {formatNumber(existingCounts.forks)} forks
        </div>
      )}

      {/* Progress bars for each metric */}
      {activeMetrics.length > 0 && (
        <div className="space-y-3">
          {activeMetrics.map(({ key, label, data, total }) => {
            const pct = getPercentage(data?.fetched, total);
            const isRateLimited = data?.rateLimit;

            return (
              <div key={key}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">{label}</span>
                  <span className="text-gray-500">
                    {formatNumber(data?.fetched)}
                    {total ? ` / ${formatNumber(total)}` : (isRefresh ? ' new' : '')}
                    {pct !== null && ` (${pct}%)`}
                    {isRateLimited && data?.secondsRemaining && (
                      <span className="text-orange-500 ml-2">
                        Rate limited - {data.secondsRemaining}s
                      </span>
                    )}
                  </span>
                </div>
                {total && total > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        isRateLimited ? 'bg-orange-400' : 'bg-blue-500'
                      }`}
                      style={{ width: `${pct || 0}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
