export default function LoadingProgress({ progress }) {
  const { totals, stars, forks, issues, prs, commits, status, isRefresh, existingCounts } = progress;

  const getPercentage = (fetched, total) => {
    if (!total || total === 0) return null;
    return Math.min(100, Math.round((fetched / total) * 100));
  };

  const formatNumber = (num, showNoneForZero = false) => {
    if (showNoneForZero && (num === 0 || num === undefined || num === null)) return 'None';
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num?.toString() || '0';
  };

  const metrics = [
    { key: 'stars', label: isRefresh ? 'New Stars' : 'Stars', data: stars, total: totals?.stars },
    { key: 'forks', label: isRefresh ? 'New Forks' : 'Forks', data: forks, total: totals?.forks },
    { key: 'issues', label: isRefresh ? 'New Issues' : 'Issues', data: issues, total: isRefresh ? null : totals?.issues },
    { key: 'prs', label: isRefresh ? 'New PRs' : 'PRs', data: prs, total: null },
    { key: 'commits', label: isRefresh ? 'New Commits' : 'Commits', data: commits, total: null },
  ];

  // During refresh, show all metrics; otherwise only show active ones
  const activeMetrics = isRefresh
    ? metrics
    : metrics.filter(m => m.data?.fetched > 0 || m.data?.rateLimit);

  // Calculate overall progress (cap fetched at expected to avoid >100%)
  const overallProgress = (() => {
    let totalFetched = 0;
    let totalExpected = 0;

    if (stars?.fetched && totals?.stars) {
      totalFetched += Math.min(stars.fetched, totals.stars);
      totalExpected += totals.stars;
    }
    if (forks?.fetched && totals?.forks) {
      totalFetched += Math.min(forks.fetched, totals.forks);
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


      {/* Progress bars for each metric */}
      {activeMetrics.length > 0 && (
        <div className="space-y-3">
          {activeMetrics.map(({ key, label, data, total }) => {
            // Cap fetched at total so display never shows more than expected
            const fetched = data?.fetched || 0;
            const displayFetched = total ? Math.min(fetched, total) : fetched;
            const pct = getPercentage(displayFetched, total);
            const isRateLimited = data?.rateLimit;
            const isComplete = total && displayFetched >= total;

            const isDone = data?.done;
            const hasActivity = fetched > 0 || isRateLimited || isDone;

            return (
              <div key={key}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">{label}</span>
                  <span className="text-gray-500">
                    {isRefresh && isDone && fetched === 0 ? (
                      <>None</>
                    ) : (
                      <>
                        {formatNumber(displayFetched)}
                        {total ? ` / ${formatNumber(total)}` : (isRefresh && fetched > 0 ? ' new' : '')}
                        {pct !== null && ` (${pct}%)`}
                      </>
                    )}
                    {(isComplete || isDone) && <span className="text-green-500 ml-1">✓</span>}
                    {isRateLimited && data?.secondsRemaining && (
                      <span className="text-orange-500 ml-2">
                        Rate limited - {data.secondsRemaining}s
                      </span>
                    )}
                  </span>
                </div>
                {/* Show progress bar: determinate if we have total, indeterminate otherwise */}
                {(total && total > 0) ? (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        isRateLimited ? 'bg-orange-400' : isComplete ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${pct || 0}%` }}
                    />
                  </div>
                ) : (
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    {isDone ? (
                      <div className="h-2 rounded-full bg-green-500 w-full" />
                    ) : hasActivity ? (
                      <div className="h-2 rounded-full bg-blue-500 animate-pulse w-full opacity-60" />
                    ) : (
                      <div className="h-2 rounded-full bg-gray-300 w-0" />
                    )}
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
