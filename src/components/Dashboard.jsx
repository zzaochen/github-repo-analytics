import { useState } from 'react';
import SummaryCards from './SummaryCards';
import StarsChart from './StarsChart';
import ForksChart from './ForksChart';
import ContributorsChart from './ContributorsChart';
import IssuesChart from './IssuesChart';
import PRsChart from './PRsChart';
import ExportButton from './ExportButton';
import { updateRepoCompanyInfo } from '../services/supabase';

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
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

function formatNumberWithCommas(num) {
  return num?.toLocaleString('en-US') || '0';
}

export default function Dashboard({ repoInfo, dailyData, dataSource, lastFetched, onForceRefresh, paginationLimited, onContinueFetching, onDeleteAndRefetch, companyInfo, onCompanyInfoUpdate, onOpenPrTimeline }) {
  const latestMetrics = dailyData[dailyData.length - 1];
  const firstDate = dailyData[0]?.date;
  const lastDate = dailyData[dailyData.length - 1]?.date;

  const [isEditingCompany, setIsEditingCompany] = useState(false);
  const [companyName, setCompanyName] = useState(companyInfo?.company_name || '');
  const [companyUrl, setCompanyUrl] = useState(companyInfo?.company_url || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveCompanyInfo = async () => {
    setIsSaving(true);
    const [owner, repo] = repoInfo.name.split('/');
    const result = await updateRepoCompanyInfo(owner, repo, companyName, companyUrl);
    if (result.success && onCompanyInfoUpdate) {
      onCompanyInfoUpdate({ company_name: companyName, company_url: companyUrl });
    }
    setIsSaving(false);
    setIsEditingCompany(false);
  };

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
          detail: null
        };
    }
  };

  const status = getStatusDisplay();

  return (
    <div className="dashboard-container">
      <div className="flex justify-between items-center mb-4">
        <div className="min-w-0">
          <h2 className="dashboard-heading font-bold text-gray-900 flex items-center gap-2 flex-wrap">
            {repoInfo.name}
            <a
              href={`https://github.com/${repoInfo.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-gray-700 transition-colors"
              title="View on GitHub"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
            {onOpenPrTimeline && (
              <button
                onClick={onOpenPrTimeline}
                className="flex items-center gap-1 px-2 py-1 ml-2 translate-y-0.5 bg-gray-900 hover:bg-black text-white rounded text-xs font-medium transition-colors"
                title="View merged PR history timeline"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                </svg>
                PR History
              </button>
            )}
          </h2>
          <p className="text-gray-500 text-sm mt-1">Last updated: {formatDate(lastFetched)}</p>

          {/* Company Info */}
          <div className="mt-2">
            {isEditingCompany ? (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Company name"
                  className="px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="url"
                  value={companyUrl}
                  onChange={(e) => setCompanyUrl(e.target.value)}
                  placeholder="Company URL"
                  className="px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleSaveCompanyInfo}
                  disabled={isSaving}
                  className="px-2 py-1 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setIsEditingCompany(false);
                    setCompanyName(companyInfo?.company_name || '');
                    setCompanyUrl(companyInfo?.company_url || '');
                  }}
                  className="px-2 py-1 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                {companyInfo?.company_name ? (
                  <>
                    <span className="text-gray-600">Company:</span>
                    {companyInfo?.company_url ? (
                      <a
                        href={companyInfo.company_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {companyInfo.company_name}
                      </a>
                    ) : (
                      <span className="text-gray-800">{companyInfo.company_name}</span>
                    )}
                  </>
                ) : (
                  <span className="text-gray-400 italic">No company info</span>
                )}
                <button
                  onClick={() => setIsEditingCompany(true)}
                  className="text-gray-400 hover:text-gray-600"
                  title="Edit company info"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ExportButton data={dailyData} repoName={repoInfo.name} />
        </div>
      </div>

      {/* Data source indicator */}
      <div className="status-bar flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2 mb-6 shadow-sm gap-2">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="flex items-center gap-2">
            <span className={`w-2 h-2 bg-${status.color}-500 rounded-full`}></span>
            <span className={`text-${status.color}-600 font-medium`}>{status.label}</span>
          </span>
          {status.detail && (
            <>
              <span className="text-gray-300 status-detail">|</span>
              <span className="text-gray-600 status-detail">{status.detail}</span>
            </>
          )}
          <span className="text-gray-300 status-detail">|</span>
          <span className="text-gray-600 status-detail">
            Data: {formatDateShort(firstDate)} → {formatDateShort(lastDate)} ({formatNumberWithCommas(dailyData.length)} days)
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {paginationLimited && (
            <button
              onClick={onContinueFetching}
              className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm transition-colors whitespace-nowrap"
              title="Continue fetching data from where pagination limits were hit"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clipRule="evenodd" />
              </svg>
              <span className="hidden xl:inline">Continue Fetching</span>
            </button>
          )}
          <button
            onClick={onForceRefresh}
            className="flex items-center gap-1.5 px-2 xl:px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-xs xl:text-sm transition-colors whitespace-nowrap"
            title="Update to Today"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            <span className="hidden xl:inline">Update to Today</span>
            <span className="xl:hidden">Update</span>
          </button>
          <button
            onClick={onDeleteAndRefetch}
            className="flex items-center gap-1.5 px-2 xl:px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs xl:text-sm transition-colors whitespace-nowrap"
            title="Delete cached data and fetch fresh from GitHub"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="hidden xl:inline">Clear & Re-fetch</span>
            <span className="xl:hidden">Clear</span>
          </button>
        </div>
      </div>

      <SummaryCards repoInfo={repoInfo} latestMetrics={latestMetrics} />

      <div className="grid grid-cols-1 charts-2col gap-3 mb-4">
        <StarsChart data={dailyData} />
        <ForksChart data={dailyData} />
      </div>

      <div className="grid grid-cols-1 charts-3col gap-3">
        <ContributorsChart data={dailyData} />
        <IssuesChart data={dailyData} />
        <PRsChart data={dailyData} />
      </div>
    </div>
  );
}
