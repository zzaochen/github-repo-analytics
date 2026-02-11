import { useState, useEffect } from 'react';
import { getCachedRepos } from '../services/supabase';

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export default function CachedRepos({ onSelect, onUpdateAll, onQuickUpdateAll, isLoading }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCachedRepos();
  }, []);

  const loadCachedRepos = async () => {
    setLoading(true);
    const cached = await getCachedRepos();
    setRepos(cached);
    setLoading(false);
  };

  const handleSelectChange = (e) => {
    const value = e.target.value;
    if (!value) return;
    const [owner, repo] = value.split('/');
    onSelect(owner, repo);
    e.target.value = ''; // Reset dropdown after selection
  };

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
        <p className="text-gray-500 text-sm">Loading cached repositories...</p>
      </div>
    );
  }

  if (repos.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
      <h3 className="text-sm font-medium text-gray-700 mb-2">Cached Repositories</h3>
      {repos.length > 0 && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => onQuickUpdateAll(repos)}
            disabled={isLoading}
            className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs transition-colors"
            title="Quick update: only fetch issues & commits since last date (fast)"
          >
            Quick Update
          </button>
          <button
            onClick={() => onUpdateAll(repos)}
            disabled={isLoading}
            className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs transition-colors"
            title="Full update: fetch all metrics and resume pagination if needed"
          >
            Full Update
          </button>
        </div>
      )}
      <select
        onChange={handleSelectChange}
        disabled={isLoading}
        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        defaultValue=""
      >
        <option value="" disabled>Select a repository...</option>
        {repos.map((repo) => (
          <option key={repo.id} value={`${repo.owner}/${repo.repo}`}>
            {repo.owner}/{repo.repo}
          </option>
        ))}
      </select>
    </div>
  );
}
