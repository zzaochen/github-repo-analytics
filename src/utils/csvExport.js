import Papa from 'papaparse';

export function exportToCSV(dailyData, repoName) {
  const csvData = dailyData.map(d => ({
    Date: d.date,
    'Total Stars': d.totalStars,
    'Total Forks': d.totalForks,
    'Total Contributors': d.totalContributors,
    'Total Issues Opened': d.totalIssuesOpened,
    'Total Issues Closed': d.totalIssuesClosed,
    'Open Issues': d.openIssues,
    'Total PRs Opened': d.totalPRsOpened,
    'Total PRs Closed': d.totalPRsClosed,
    'Total PRs Merged': d.totalPRsMerged,
    'Open PRs': d.openPRs
  }));

  const csv = Papa.unparse(csvData);

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${repoName.replace('/', '-')}-analytics.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
