import { useState } from 'react';

export default function RepoInput({ onSubmit, isLoading }) {
  const [repoPath, setRepoPath] = useState('');
  const [token, setToken] = useState(import.meta.env.VITE_GITHUB_TOKEN || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = repoPath.trim();
    if (!trimmed) return;

    const parts = trimmed.replace('https://github.com/', '').split('/');
    if (parts.length >= 2) {
      onSubmit(parts[0], parts[1], token);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg p-6 mb-6">
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="repo" className="block text-sm font-medium text-gray-300 mb-2">
            GitHub Repository
          </label>
          <input
            type="text"
            id="repo"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="owner/repo (e.g., facebook/react)"
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
        </div>
        <div>
          <label htmlFor="token" className="block text-sm font-medium text-gray-300 mb-2">
            GitHub Token (required for API access)
          </label>
          <input
            type="password"
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxx"
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !repoPath.trim() || !token}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
        >
          {isLoading ? 'Loading...' : 'Analyze Repository'}
        </button>
      </div>
    </form>
  );
}
