import { useState } from 'react';

export default function TokenSettings({ user, onSignIn, onSignOut, authLoading }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="pt-4 border-t border-gray-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full"
      >
        <span className="text-sm text-gray-600">Settings</span>
        <div className="flex items-center gap-2">
          {user && <span className="w-2 h-2 bg-green-500 rounded-full" title="Authenticated"></span>}
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
        <div className="mt-3 space-y-4">
          {/* GitHub OAuth Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              GitHub Authentication
            </label>
            {user ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  {user.user_metadata?.avatar_url && (
                    <img
                      src={user.user_metadata.avatar_url}
                      alt="Avatar"
                      className="w-6 h-6 rounded-full"
                    />
                  )}
                  <span className="text-sm text-green-700">
                    Signed in as <strong>{user.user_metadata?.user_name || user.email}</strong>
                  </span>
                </div>
                <button
                  onClick={onSignOut}
                  disabled={authLoading}
                  className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded transition-colors"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={onSignIn}
                disabled={authLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {authLoading ? 'Signing in...' : 'Sign in with GitHub'}
              </button>
            )}
            <p className="text-xs text-gray-500 mt-2">
              Sign in to use your GitHub account for API access (5,000 requests/hour)
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
