export default function LoadingProgress({ progress }) {
  const items = [
    { key: 'stars', label: 'Stars' },
    { key: 'forks', label: 'Forks' },
    { key: 'issues', label: 'Issues' },
    { key: 'prs', label: 'Pull Requests' },
    { key: 'commits', label: 'Commits' }
  ];

  return (
    <div className="bg-gray-800 rounded-lg p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4">Fetching Repository Data...</h3>
      <div className="space-y-3">
        {items.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            <div className="w-32 text-gray-400">{label}</div>
            <div className="flex-1 bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: progress[key]?.done ? '100%' : '50%',
                  opacity: progress[key]?.fetched > 0 ? 1 : 0.3
                }}
              />
            </div>
            <div className="w-20 text-right text-sm text-gray-400">
              {progress[key]?.fetched || 0} fetched
            </div>
            {progress[key]?.done && (
              <span className="text-green-500">✓</span>
            )}
          </div>
        ))}
      </div>
      {progress.status && (
        <p className="mt-4 text-sm text-gray-400">{progress.status}</p>
      )}
    </div>
  );
}
