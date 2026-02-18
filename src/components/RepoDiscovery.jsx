import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

export default function RepoDiscovery() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [recentRepos, setRecentRepos] = useState([]);
  const [token, setToken] = useState('');

  useEffect(() => {
    loadStats();
    loadRecentRepos();
  }, []);

  const loadStats = async () => {
    if (!supabase) return;

    try {
      // Get total count
      const { count: totalRepos } = await supabase
        .from('discovered_repos')
        .select('*', { count: 'exact', head: true });

      // Get last progress
      const { data: progressData } = await supabase
        .from('collection_progress')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      // Get language distribution (sample)
      const { data: langData } = await supabase
        .from('discovered_repos')
        .select('language')
        .not('language', 'is', null)
        .limit(10000);

      const languageCounts = {};
      langData?.forEach(repo => {
        if (repo.language) {
          languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
        }
      });

      const topLanguages = Object.entries(languageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      // Get stars distribution
      const { data: starsData } = await supabase
        .from('discovered_repos')
        .select('stars')
        .gte('stars', 100)
        .limit(1000);

      const starsOver100 = starsData?.length || 0;
      const starsOver1000 = starsData?.filter(r => r.stars >= 1000).length || 0;
      const starsOver10000 = starsData?.filter(r => r.stars >= 10000).length || 0;

      setStats({
        totalRepos: totalRepos || 0,
        lastProgress: progressData,
        topLanguages,
        starsOver100,
        starsOver1000,
        starsOver10000
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRecentRepos = async () => {
    if (!supabase) return;

    const { data } = await supabase
      .from('discovered_repos')
      .select('*')
      .order('discovered_at', { ascending: false })
      .limit(20);

    setRecentRepos(data || []);
  };

  const startCollection = async () => {
    setCollecting(true);
    setLastResult(null);

    try {
      const response = await fetch('/api/collect-repos?manual=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token || undefined,
          maxRepos: 5000
        })
      });

      const result = await response.json();
      setLastResult(result);

      if (result.success) {
        // Reload stats
        await loadStats();
        await loadRecentRepos();
      }
    } catch (error) {
      setLastResult({ error: error.message });
    } finally {
      setCollecting(false);
    }
  };

  const formatNumber = (num) => {
    if (!num) return '0';
    return num.toLocaleString('en-US');
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <svg className="w-8 h-8 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
            <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
            <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z" />
          </svg>
          GitHub Repo Discovery
        </h2>
        <p className="text-gray-500 text-sm">
          Enumerate and collect metadata from all public GitHub repositories
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">{formatNumber(stats?.totalRepos)}</div>
          <div className="text-sm text-gray-500">Total Repos Discovered</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-2xl font-bold text-yellow-600">{formatNumber(stats?.starsOver100)}</div>
          <div className="text-sm text-gray-500">Repos with 100+ Stars</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-2xl font-bold text-orange-600">{formatNumber(stats?.starsOver1000)}</div>
          <div className="text-sm text-gray-500">Repos with 1K+ Stars</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-2xl font-bold text-red-600">{formatNumber(stats?.starsOver10000)}</div>
          <div className="text-sm text-gray-500">Repos with 10K+ Stars</div>
        </div>
      </div>

      {/* Collection Controls */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Collection Controls</h3>

        <div className="flex items-end gap-4 mb-4">
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-1">GitHub Token (optional, for higher rate limits)</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={startCollection}
            disabled={collecting}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              collecting
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-purple-500 text-white hover:bg-purple-600'
            }`}
          >
            {collecting ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Collecting...
              </span>
            ) : (
              'Start Collection'
            )}
          </button>
        </div>

        {/* Last Progress */}
        {stats?.lastProgress && (
          <div className="text-sm text-gray-600 mb-2">
            <span className="font-medium">Last run:</span>{' '}
            {formatDate(stats.lastProgress.updated_at)} -{' '}
            {formatNumber(stats.lastProgress.repos_collected)} repos collected,{' '}
            last ID: {formatNumber(stats.lastProgress.last_repo_id)},{' '}
            status: <span className={stats.lastProgress.status === 'completed' ? 'text-green-600' : 'text-yellow-600'}>
              {stats.lastProgress.status}
            </span>
          </div>
        )}

        {/* Last Result */}
        {lastResult && (
          <div className={`p-3 rounded-lg text-sm ${lastResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {lastResult.success ? (
              <>
                Collected {formatNumber(lastResult.collected)} repos in {(lastResult.elapsedMs / 1000).toFixed(1)}s.
                Last repo ID: {formatNumber(lastResult.lastRepoId)}.
                {lastResult.rateLimit && ` Rate limit remaining: ${lastResult.rateLimit.remaining}`}
              </>
            ) : (
              <>Error: {lastResult.error}</>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Languages */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <h3 className="font-semibold text-gray-900">Top Languages</h3>
          </div>
          <div className="p-4">
            {stats?.topLanguages?.length > 0 ? (
              <div className="space-y-2">
                {stats.topLanguages.map(([lang, count], index) => (
                  <div key={lang} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{index + 1}. {lang}</span>
                    <span className="text-sm font-medium text-gray-900">{formatNumber(count)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No data yet</p>
            )}
          </div>
        </div>

        {/* Recently Discovered */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <h3 className="font-semibold text-gray-900">Recently Discovered</h3>
          </div>
          <div className="p-4 max-h-[400px] overflow-y-auto">
            {recentRepos.length > 0 ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pb-2 font-medium">Repository</th>
                    <th className="pb-2 font-medium text-right">Stars</th>
                    <th className="pb-2 font-medium text-right">Language</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRepos.map(repo => (
                    <tr key={repo.github_id} className="border-t border-gray-100">
                      <td className="py-1.5">
                        <a
                          href={`https://github.com/${repo.full_name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline truncate block max-w-[200px]"
                          title={repo.full_name}
                        >
                          {repo.full_name}
                        </a>
                      </td>
                      <td className="py-1.5 text-right text-gray-600">
                        {formatNumber(repo.stars)}
                      </td>
                      <td className="py-1.5 text-right text-gray-500">
                        {repo.language || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-500">No repos discovered yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="text-sm font-semibold text-blue-800 mb-2">How it works</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Uses GitHub's <code className="bg-blue-100 px-1 rounded">/repositories</code> endpoint to enumerate all public repos</li>
          <li>• Collects up to 5,000 repos per run (rate limit: 500K/hour with token)</li>
          <li>• Resumes from last position automatically</li>
          <li>• GitHub has 200M+ public repos - full collection takes time</li>
          <li>• Provide a GitHub token for 5,000 requests/hour (vs 60/hour without)</li>
        </ul>
      </div>
    </div>
  );
}
