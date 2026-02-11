import Papa from 'papaparse';
import * as XLSX from 'xlsx';

function formatData(dailyData) {
  return dailyData.map(d => ({
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
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCSV(dailyData, repoName) {
  const data = formatData(dailyData);
  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadFile(blob, `${repoName.replace('/', '-')}-analytics.csv`);
}

export function exportToXLSX(dailyData, repoName) {
  const data = formatData(dailyData);
  const worksheet = XLSX.utils.json_to_sheet(data);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 12 },  // Date
    { wch: 12 },  // Total Stars
    { wch: 12 },  // Total Forks
    { wch: 18 },  // Total Contributors
    { wch: 18 },  // Total Issues Opened
    { wch: 18 },  // Total Issues Closed
    { wch: 12 },  // Open Issues
    { wch: 16 },  // Total PRs Opened
    { wch: 16 },  // Total PRs Closed
    { wch: 16 },  // Total PRs Merged
    { wch: 10 },  // Open PRs
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Analytics');

  const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadFile(blob, `${repoName.replace('/', '-')}-analytics.xlsx`);
}
