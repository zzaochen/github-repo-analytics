import SummaryCards from './SummaryCards';
import StarsChart from './StarsChart';
import ForksChart from './ForksChart';
import ContributorsChart from './ContributorsChart';
import IssuesChart from './IssuesChart';
import PRsChart from './PRsChart';
import ExportButton from './ExportButton';

export default function Dashboard({ repoInfo, dailyData }) {
  const latestMetrics = dailyData[dailyData.length - 1];

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">{repoInfo.name}</h2>
          {repoInfo.description && (
            <p className="text-gray-400 mt-1">{repoInfo.description}</p>
          )}
        </div>
        <ExportButton data={dailyData} repoName={repoInfo.name} />
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
