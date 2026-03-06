export default function SummaryCards({ repoInfo, latestMetrics, onOpenPrTimeline }) {
  // Use repoInfo.stars as fallback when historical star data is missing (common for large repos)
  const starsValue = (latestMetrics?.totalStars > 0)
    ? latestMetrics.totalStars
    : repoInfo?.stars || 0;

  const cards = [
    {
      label: 'Total Stars',
      value: starsValue.toLocaleString(),
      color: 'text-yellow-600',
      note: latestMetrics?.totalStars === 0 && repoInfo?.stars > 0 ? '(current)' : null
    },
    {
      label: 'Total Forks',
      value: latestMetrics?.totalForks?.toLocaleString() || repoInfo?.forks?.toLocaleString() || '0',
      color: 'text-blue-600'
    },
    {
      label: 'Contributors',
      value: latestMetrics?.totalContributors?.toLocaleString() || '0',
      color: 'text-green-600'
    },
    {
      label: 'Total Issues',
      value: latestMetrics?.totalIssuesOpened?.toLocaleString() || '0',
      color: 'text-purple-600'
    },
    {
      label: 'Total PRs',
      value: latestMetrics?.totalPRsOpened?.toLocaleString() || '0',
      color: 'text-pink-600'
    }
  ];

  return (
    <div className="grid grid-cols-2 summary-grid gap-3 mb-6">
      {cards.map(({ label, value, color, note }) => (
        <div key={label} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
          <p className="text-gray-500 text-xs mb-1">{label}</p>
          <p className={`text-lg font-bold ${color}`}>
            {value}
            {note && <span className="text-xs text-gray-400 ml-1">{note}</span>}
          </p>
          {label === 'Total PRs' && onOpenPrTimeline && (
            <button
              onClick={onOpenPrTimeline}
              className="mt-2 flex items-center gap-1 px-2 py-1 bg-gray-900 hover:bg-black text-white rounded text-xs font-medium transition-colors"
              title="View merged PR history timeline"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              PR History
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
