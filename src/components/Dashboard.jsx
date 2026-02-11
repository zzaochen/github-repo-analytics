import SummaryCards from './SummaryCards';
import StarsChart from './StarsChart';
import ForksChart from './ForksChart';
import ContributorsChart from './ContributorsChart';
import IssuesChart from './IssuesChart';
import PRsChart from './PRsChart';
import ExportButton from './ExportButton';

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export default function Dashboard({ repoInfo, dailyData, dataSource, lastFetched, onForceRefresh, paginationLimited, onContinueFetching, onDeleteAndRefetch }) {
  const latestMetrics = dailyData[dailyData.length - 1];
  const firstDate = dailyData[0]?.date;
  const lastDate = dailyData[dailyData.length - 1]?.date;

  const getStatusDisplay = () => {
    switch (dataSource) {
      case 'cache':
        return {
          color: 'blue',
          label: 'Loaded from cache',
          detail: `Last updated ${formatDate(lastFetched)}`
        };
      case 'incremental':
        return {
          color: 'purple',
          label: 'Incrementally updated',
          detail: 'Merged new data with cache'
        };
      case 'github':
      default:
        return {
          color: 'green',
          label: 'Fetched from GitHub',
          detail: 'Full historical fetch'
        };
    }
  };

  const status = getStatusDisplay();

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{repoInfo.name}</h2>
          <p className="text-gray-500 text-sm mt-1">Last updated: {formatDate(lastFetched)}</p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButton data={dailyData} repoName={repoInfo.name} />
        </div>
      </div>

      {/* Data source indicator */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3 mb-6 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-2">
            <span className={`w-2 h-2 bg-${status.color}-500 rounded-full`}></span>
            <span className={`text-${status.color}-600 font-medium`}>{status.label}</span>
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-gray-600 text-sm">{status.detail}</span>
          <span className="text-gray-300">|</span>
          <span className="text-gray-600 text-sm">
            Data: {formatDateShort(firstDate)} → {formatDateShort(lastDate)} ({dailyData.length} days)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {paginationLimited && (
            <button
              onClick={onContinueFetching}
              className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm transition-colors whitespace-nowrap"
              title="Continue fetching data from where pagination limits were hit"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clipRule="evenodd" />
              </svg>
              Continue Fetching
            </button>
          )}
          <button
            onClick={onForceRefresh}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors whitespace-nowrap"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            Update to Today
          </button>
          <button
            onClick={onDeleteAndRefetch}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors whitespace-nowrap"
            title="Delete cached data and fetch fresh from GitHub"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Clear & Re-fetch
          </button>
        </div>
      </div>

      <SummaryCards repoInfo={repoInfo} latestMetrics={latestMetrics} />

      <div className="grid grid-cols-2 gap-4 mb-4">
        <StarsChart data={dailyData} />
        <ForksChart data={dailyData} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <ContributorsChart data={dailyData} />
        <IssuesChart data={dailyData} />
        <PRsChart data={dailyData} />
      </div>
    </div>
  );
}
