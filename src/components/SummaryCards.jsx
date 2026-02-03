export default function SummaryCards({ repoInfo, latestMetrics }) {
  const cards = [
    {
      label: 'Total Stars',
      value: latestMetrics?.totalStars?.toLocaleString() || repoInfo?.stars?.toLocaleString() || '0',
      color: 'text-yellow-400'
    },
    {
      label: 'Total Forks',
      value: latestMetrics?.totalForks?.toLocaleString() || repoInfo?.forks?.toLocaleString() || '0',
      color: 'text-blue-400'
    },
    {
      label: 'Contributors',
      value: latestMetrics?.totalContributors?.toLocaleString() || '0',
      color: 'text-green-400'
    },
    {
      label: 'Total Issues',
      value: latestMetrics?.totalIssuesOpened?.toLocaleString() || '0',
      color: 'text-purple-400'
    },
    {
      label: 'Total PRs',
      value: latestMetrics?.totalPRsOpened?.toLocaleString() || '0',
      color: 'text-pink-400'
    }
  ];

  return (
    <div className="grid grid-cols-5 gap-4 mb-6">
      {cards.map(({ label, value, color }) => (
        <div key={label} className="bg-gray-800 rounded-lg p-4">
          <p className="text-gray-400 text-sm mb-1">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}
