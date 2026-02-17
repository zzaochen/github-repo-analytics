import { useState, useEffect } from 'react';
import { getMilestoneEvents, backfillAllMilestones, STAR_MILESTONES } from '../services/supabase';

export default function MilestonesView() {
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
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
      setBackfilling(true);
      await backfillAllMilestones();
      data = await getMilestoneEvents(100);
      setBackfilling(false);
    }

    setMilestones(data);
    setLoading(false);
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    const result = await backfillAllMilestones();
    if (result.success) {
      console.log(`Backfill complete: ${result.milestonesAdded} milestones added`);
    }
    await loadMilestones(false);
    setBackfilling(false);
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

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredMilestones = filter === 'all'
    ? milestones
    : milestones.filter(m => m.milestone_type === filter);

  // Group milestones by date for timeline view
  const groupedByDate = filteredMilestones.reduce((acc, milestone) => {
    const date = new Date(milestone.crossed_at).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(milestone);
    return acc;
  }, {});

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
        <div className="flex gap-2">
          <button
            onClick={handleBackfill}
            disabled={loading || backfilling}
            className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {backfilling ? (
              <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
            )}
            {backfilling ? 'Scanning...' : 'Scan All Repos'}
          </button>
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
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {STAR_MILESTONES.map(milestone => {
          const count = milestones.filter(m => m.milestone_type === milestone.type).length;
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
        {STAR_MILESTONES.map(milestone => (
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

      {/* Timeline */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">
          <svg className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading milestones...
        </div>
      ) : filteredMilestones.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <div className="text-4xl mb-4">🎯</div>
          <p className="text-lg">No milestones recorded yet</p>
          <p className="text-sm mt-2">
            Milestones are recorded when repos cross 5K, 10K, 25K, 50K, or 100K stars during data refresh
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByDate).map(([date, events]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-gray-500 mb-3 sticky top-0 bg-gray-50 py-2">
                {date}
              </h3>
              <div className="space-y-3">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${getMilestoneColor(event.milestone_type)}`}>
                        {getMilestoneIcon(event.milestone_type)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://github.com/${event.repositories?.owner}/${event.repositories?.repo}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-gray-900 hover:text-blue-600 transition-colors"
                          >
                            {event.repositories?.owner}/{event.repositories?.repo}
                          </a>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getMilestoneColor(event.milestone_type)}`}>
                            {getMilestoneLabel(event.milestone_type)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500">
                          Reached {event.stars_at_crossing.toLocaleString()} stars
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">
                        {new Date(event.crossed_at).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
