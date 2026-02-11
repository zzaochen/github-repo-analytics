import { useState } from 'react';

export default function RepoInput({ onSubmit, isLoading, token }) {
  const [repoPath, setRepoPath] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = repoPath.trim();
    if (!trimmed || !token) return;

    const parts = trimmed.replace('https://github.com/', '').split('/');
    if (parts.length >= 2) {
      onSubmit(parts[0], parts[1], token);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
      <h3 className="text-sm font-medium text-gray-700 mb-3">GitHub Repository</h3>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-3">
          <input
            type="text"
            id="repo"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="owner/repo (e.g., facebook/react)"
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !repoPath.trim() || !token}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
          >
            {isLoading ? 'Loading...' : 'Analyze'}
          </button>
        </div>
      </form>
    </div>
  );
}
