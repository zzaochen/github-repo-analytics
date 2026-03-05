import { useState, useEffect, useRef } from 'react';

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatNumber(num) {
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toLocaleString();
}

// Group PRs by month
function groupByMonth(timeline) {
  const groups = [];
  let currentMonth = null;
  let currentGroup = null;

  for (const pr of timeline) {
    const date = new Date(pr.mergedAt);
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    if (monthKey !== currentMonth) {
      currentMonth = monthKey;
      currentGroup = {
        label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        prs: [],
      };
      groups.push(currentGroup);
    }
    currentGroup.prs.push(pr);
  }

  return groups;
}

function ImpactSummary({ timeline, overallSummary }) {
  const totalPRs = timeline.length;
  const totalAdditions = timeline.reduce((sum, pr) => sum + pr.additions, 0);
  const totalDeletions = timeline.reduce((sum, pr) => sum + pr.deletions, 0);
  const uniqueAuthors = new Set(timeline.map(pr => pr.author)).size;

  return (
    <div className="mx-3 mt-3 mb-1 p-3 bg-gray-50 rounded-xl border border-gray-100">
      <div className="grid grid-cols-2 gap-3">
        <div className="text-center">
          <div className="text-xl font-bold text-gray-900">{totalPRs}</div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">PRs Merged</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-gray-900">{uniqueAuthors}</div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">Contributors</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-green-600">+{formatNumber(totalAdditions)}</div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">Additions</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-red-500">-{formatNumber(totalDeletions)}</div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">Deletions</div>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-gray-200 text-center">
        <span className="text-xs text-gray-400">
          Net change: <span className={totalAdditions - totalDeletions >= 0 ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}>
            {totalAdditions - totalDeletions >= 0 ? '+' : ''}{formatNumber(totalAdditions - totalDeletions)} lines
          </span>
        </span>
      </div>
      {overallSummary && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <p className="text-xs text-gray-600 leading-relaxed">{overallSummary}</p>
        </div>
      )}
    </div>
  );
}

export default function PRTimeline({ repoName, token }) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [overallSummary, setOverallSummary] = useState('');

  const fetchTimeline = async () => {
    if (!repoName) return;

    const [owner, repo] = repoName.split('/');
    if (!owner || !repo) return;

    setLoading(true);
    setError(null);

    try {
      const apiUrl = import.meta.env.DEV ? 'http://localhost:3001/api/pr-timeline' : '/api/pr-timeline';
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, githubToken: token }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setTimeline(data.timeline || []);
      setOverallSummary(data.overallSummary || '');
      setTruncated(data.truncated || false);
    } catch (err) {
      setError(err.message || 'Failed to fetch PR timeline');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (repoName) {
      fetchTimeline();
    }
  }, [repoName]);

  if (!repoName) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm px-4">
        Select a repository to view PR history
      </div>
    );
  }

  const groups = groupByMonth(timeline);

  return (
    <div className="flex flex-col h-full">
      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Fetching merged PRs & generating summaries...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="px-4 py-3 m-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && timeline.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-sm">No merged PRs in the last 3 months</span>
        </div>
      )}

      {/* Timeline */}
      {!loading && timeline.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {/* Impact summary */}
          <ImpactSummary timeline={timeline} overallSummary={overallSummary} />

          {groups.map((group) => (
            <div key={group.label}>
              {/* Month header */}
              <div className="sticky top-0 bg-gray-50 px-4 py-1.5 border-b border-gray-100 z-10">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {group.label}
                </span>
              </div>

              {/* Timeline track */}
              <div className="relative pl-8 pr-4 py-2">
                {/* Vertical line */}
                <div className="absolute left-[1.19rem] top-0 bottom-0 w-px bg-gray-200" />

                {group.prs.map((pr) => (
                  <div key={pr.number} className="relative pb-4 last:pb-2 group">
                    {/* Dot on the line */}
                    <div className="absolute left-[-1.06rem] top-1.5 w-2.5 h-2.5 rounded-full bg-gray-900 border-2 border-white ring-2 ring-gray-200 group-hover:ring-gray-400 transition-all" />

                    {/* Bubble card */}
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 shadow-sm hover:shadow-md hover:border-gray-300 transition-all cursor-pointer no-underline"
                    >
                      {/* Top row: PR number + date */}
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-bold text-gray-900">
                          #{pr.number}
                        </span>
                        <span className="text-[11px] text-gray-400">
                          {formatDate(pr.mergedAt)}
                        </span>
                      </div>

                      {/* Summary */}
                      <p className="text-[13px] text-gray-700 leading-snug mb-1.5">
                        {pr.summary}
                      </p>

                      {/* Bottom row: author + diff stats */}
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-400 font-medium">
                          @{pr.author}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600 font-semibold">
                            +{formatNumber(pr.additions)}
                          </span>
                          <span className="text-red-500 font-semibold">
                            -{formatNumber(pr.deletions)}
                          </span>
                        </div>
                      </div>
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {truncated && (
            <div className="text-center py-3 text-xs text-gray-400 border-t border-gray-100">
              Showing first 50 PRs (more available)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
