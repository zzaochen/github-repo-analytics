import { useState } from 'react';

export default function TokenSettings({ token, setToken, saveToken, setSaveToken }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleClearToken = () => {
    setToken('');
    localStorage.removeItem('github_analytics_token');
  };

  return (
    <div className="pt-4 border-t border-gray-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full"
      >
        <span className="text-sm text-gray-600">Settings</span>
        <div className="flex items-center gap-2">
          {token && <span className="w-2 h-2 bg-green-500 rounded-full" title="Token set"></span>}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="mt-3">
          <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-2">
            GitHub Token
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            {token && (
              <button
                type="button"
                onClick={handleClearToken}
                className="px-2 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs transition-colors"
                title="Clear saved token"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <input
              type="checkbox"
              id="saveToken"
              checked={saveToken}
              onChange={(e) => setSaveToken(e.target.checked)}
              className="rounded border-gray-300"
            />
            <label htmlFor="saveToken" className="text-xs text-gray-600">
              Remember token in browser
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
