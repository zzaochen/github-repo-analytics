export default function SummaryCards({ repoInfo, latestMetrics }) {
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
    <div className="grid grid-cols-5 gap-4 mb-6">
      {cards.map(({ label, value, color, note }) => (
        <div key={label} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <p className="text-gray-500 text-sm mb-1">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>
            {value}
            {note && <span className="text-xs text-gray-400 ml-1">{note}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}
