import { useState, useEffect } from 'react';
import { getMilestoneEvents, backfillAllMilestones, STAR_MILESTONES } from '../services/supabase';

export default function MilestonesView() {
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'stars_5k', 'stars_10k', 'stars_25k', etc.

  useEffect(() => {
    loadMilestones(true); // true = auto-backfill if empty
  }, []);

  const loadMilestones = async (autoBackfill = false) => {
    setLoading(true);
    let data = await getMilestoneEvents(100);

    // Auto-backfill if no milestones exist
    if (autoBackfill && (!data || data.length === 0)) {
      console.log('No milestones found, running backfill...');
      await backfillAllMilestones();
      data = await getMilestoneEvents(100);
    }

    setMilestones(data);
    setLoading(false);
  };

  const getMilestoneIcon = (type) => {
    switch (type) {
      case 'stars_5k':
        return '⭐';
      case 'stars_10k':
        return '🌟';
      case 'stars_25k':
        return '💫';
      case 'stars_50k':
        return '✨';
      case 'stars_100k':
        return '🏆';
      default:
        return '⭐';
    }
  };

  const getMilestoneLabel = (type) => {
    const milestone = STAR_MILESTONES.find(m => m.type === type);
    return milestone ? milestone.label : type;
  };

  const getMilestoneColor = (type) => {
    switch (type) {
      case 'stars_5k':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'stars_10k':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'stars_25k':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'stars_50k':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'stars_100k':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Group milestones by repo - each repo appears once with checkmarks for milestones hit
  const repoMilestones = milestones.reduce((acc, milestone) => {
    const repoKey = `${milestone.repositories?.owner}/${milestone.repositories?.repo}`;
    if (!acc[repoKey]) {
      acc[repoKey] = {
        owner: milestone.repositories?.owner,
        repo: milestone.repositories?.repo,
        fullName: repoKey,
        milestones: {},
        latestStars: 0,
        latestDate: null
      };
    }
    acc[repoKey].milestones[milestone.milestone_type] = true;
    // Track highest star count and latest date
    if (milestone.stars_at_crossing > acc[repoKey].latestStars) {
      acc[repoKey].latestStars = milestone.stars_at_crossing;
    }
    if (!acc[repoKey].latestDate || new Date(milestone.crossed_at) > new Date(acc[repoKey].latestDate)) {
      acc[repoKey].latestDate = milestone.crossed_at;
    }
    return acc;
  }, {});

  // Convert to array and sort by stars
  const repoList = Object.values(repoMilestones).sort((a, b) => b.latestStars - a.latestStars);

  // Filter repos based on selected milestone filter
  const filteredRepos = filter === 'all'
    ? repoList
    : repoList.filter(repo => repo.milestones[filter]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>🏆</span>
            Milestones
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Track when repositories hit star milestones
          </p>
        </div>
        <button
          onClick={() => loadMilestones(false)}
          disabled={loading}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {[...STAR_MILESTONES].reverse().map(milestone => {
          const count = repoList.filter(repo => repo.milestones[milestone.type]).length;
          return (
            <div
              key={milestone.type}
              className={`p-4 rounded-lg border ${getMilestoneColor(milestone.type)}`}
            >
              <div className="text-2xl mb-1">{getMilestoneIcon(milestone.type)}</div>
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-xs opacity-75">{milestone.label}</div>
            </div>
          );
        })}
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            filter === 'all'
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {[...STAR_MILESTONES].reverse().map(milestone => (
          <button
            key={milestone.type}
            onClick={() => setFilter(milestone.type)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
              filter === milestone.type
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {getMilestoneIcon(milestone.type)} {milestone.label}
          </button>
        ))}
      </div>

      {/* Milestones Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm w-1/2">
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <svg className="w-6 h-6 text-blue-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-4">🎯</div>
              <p className="text-lg">No milestones recorded yet</p>
              <p className="text-sm mt-2">
                Milestones are recorded when repos cross 5K, 10K, 25K, 50K, or 100K stars during data refresh
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 text-xs">
                  <th className="pb-2 font-medium w-8">#</th>
                  <th className="pb-2 font-medium">Repository</th>
                  <th className="pb-2 font-medium text-right w-20">Stars</th>
                  {[...STAR_MILESTONES].reverse().map(milestone => (
                    <th key={milestone.type} className="pb-2 font-medium text-center w-12">
                      {milestone.label.replace(' Stars', '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRepos.map((repo, index) => (
                  <tr key={repo.fullName} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-400">{index + 1}</td>
                    <td className="py-1.5">
                      <a
                        href={`https://github.com/${repo.fullName}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {repo.fullName}
                      </a>
                    </td>
                    <td className="py-1.5 text-right text-gray-600">
                      {repo.latestStars.toLocaleString()}
                    </td>
                    {[...STAR_MILESTONES].reverse().map(milestone => (
                      <td key={milestone.type} className="py-1.5 text-center">
                        {repo.milestones[milestone.type] ? (
                          <span className="text-green-600">✓</span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
