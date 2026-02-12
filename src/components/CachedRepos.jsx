import { useState, useEffect, useRef } from 'react';
import { getCachedRepos } from '../services/supabase';

export default function CachedRepos({ onSelect, isLoading }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    loadCachedRepos();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadCachedRepos = async () => {
    setLoading(true);
    const cached = await getCachedRepos();
    setRepos(cached);
    setLoading(false);
  };

  const filteredRepos = repos.filter(repo => {
    const repoKey = `${repo.owner}/${repo.repo}`.toLowerCase();
    return repoKey.includes(searchTerm.toLowerCase());
  });

  const handleSelect = (repo) => {
    onSelect(repo.owner, repo.repo);
    setSearchTerm('');
    setIsOpen(false);
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
      <div className="relative" ref={containerRef}>
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search repositories..."
          disabled={isLoading}
          className="w-full px-3 py-2 pr-10 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
        </svg>

        {isOpen && filteredRepos.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {filteredRepos.map((repo) => (
              <button
                key={repo.id}
                onClick={() => handleSelect(repo)}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
              >
                {repo.owner}/{repo.repo}
              </button>
            ))}
          </div>
        )}

        {isOpen && searchTerm && filteredRepos.length === 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3">
            <p className="text-sm text-gray-500">No repositories found</p>
          </div>
        )}
      </div>
    </div>
  );
}
