// Incremental aggregation: adds new data to existing metrics
// Used for "Update to Today" operations
export function aggregateIncrementalToDaily(existingMetrics, sinceDate, stargazers, forks, issues, prs, commits) {
  // First calculate existingBefore so we can get the correct lastMetric
  const sinceDateStr = sinceDate.split('T')[0];
  const existingBefore = existingMetrics
    ? existingMetrics.filter(m => m.date < sinceDateStr)
    : [];

  // Get last known cumulative totals from data BEFORE sinceDate (not the lastDate itself)
  // This ensures continuity when we merge existingBefore with newMetrics
  const lastMetric = existingBefore.length > 0
    ? existingBefore[existingBefore.length - 1]
    : null;

  console.log('=== aggregateIncrementalToDaily Debug ===');
  console.log('sinceDate:', sinceDate, '-> sinceDateStr:', sinceDateStr);
  console.log('existingMetrics count:', existingMetrics?.length || 0);
  console.log('existingBefore count:', existingBefore.length);
  console.log('lastMetric date:', lastMetric?.date, 'totalStars:', lastMetric?.totalStars);
  console.log('New data counts - stars:', stargazers.length, 'forks:', forks.length, 'issues:', issues.length, 'prs:', prs.length, 'commits:', commits.length);

  let totalStars = lastMetric?.totalStars || 0;
  let totalForks = lastMetric?.totalForks || 0;
  let totalContributors = lastMetric?.totalContributors || 0;
  let totalCommits = lastMetric?.totalCommits || 0;
  let totalIssuesOpened = lastMetric?.totalIssuesOpened || 0;
  let totalIssuesClosed = lastMetric?.totalIssuesClosed || 0;
  let totalPRsOpened = lastMetric?.totalPRsOpened || 0;
  let totalPRsClosed = lastMetric?.totalPRsClosed || 0;
  let totalPRsMerged = lastMetric?.totalPRsMerged || 0;

  // We only have cumulative contributor counts in cached metrics (not identities),
  // so re-counting "new contributors" from incremental commits can double-count
  // existing authors on repeated refreshes. Preserve the prior total to avoid drift.
  const seenContributors = new Set();

  // Create a map for days starting from sinceDate (use UTC to avoid timezone issues)
  const dayMap = new Map();
  const todayStr = new Date().toISOString().split('T')[0];

  // Iterate from sinceDateStr to today using string comparison (timezone-safe)
  let currentDateStr = sinceDateStr;
  while (currentDateStr <= todayStr) {
    dayMap.set(currentDateStr, {
      date: currentDateStr,
      starsAdded: 0,
      forksAdded: 0,
      commitsAdded: 0,
      issuesOpened: 0,
      issuesClosed: 0,
      prsOpened: 0,
      prsClosed: 0,
      prsMerged: 0,
      newContributors: new Set()
    });
    // Add one day using UTC
    const nextDate = new Date(currentDateStr + 'T12:00:00Z'); // Use noon to avoid DST edge cases
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    currentDateStr = nextDate.toISOString().split('T')[0];
  }

  // Aggregate new stars
  stargazers.forEach(s => {
    const dateKey = s.starredAt.split('T')[0];
    if (dayMap.has(dateKey)) {
      dayMap.get(dateKey).starsAdded++;
    }
  });

  // Aggregate new forks
  forks.forEach(f => {
    const dateKey = f.createdAt.split('T')[0];
    if (dayMap.has(dateKey)) {
      dayMap.get(dateKey).forksAdded++;
    }
  });

  // Aggregate new issues
  issues.forEach(i => {
    const openedDateKey = i.createdAt.split('T')[0];
    if (dayMap.has(openedDateKey)) {
      dayMap.get(openedDateKey).issuesOpened++;
    }
    if (i.closedAt) {
      const closedDateKey = i.closedAt.split('T')[0];
      if (dayMap.has(closedDateKey)) {
        dayMap.get(closedDateKey).issuesClosed++;
      }
    }
  });

  // Aggregate new PRs
  prs.forEach(pr => {
    const openedDateKey = pr.createdAt.split('T')[0];
    if (dayMap.has(openedDateKey)) {
      dayMap.get(openedDateKey).prsOpened++;
    }
    if (pr.closedAt) {
      const closedDateKey = pr.closedAt.split('T')[0];
      if (dayMap.has(closedDateKey)) {
        dayMap.get(closedDateKey).prsClosed++;
      }
    }
    if (pr.mergedAt) {
      const mergedDateKey = pr.mergedAt.split('T')[0];
      if (dayMap.has(mergedDateKey)) {
        dayMap.get(mergedDateKey).prsMerged++;
      }
    }
  });

  // Track commits and new contributors
  commits.forEach(c => {
    const dateKey = c.date.split('T')[0];
    if (dayMap.has(dateKey)) {
      dayMap.get(dateKey).commitsAdded++;
      if (c.author && !seenContributors.has(c.author)) {
        seenContributors.add(c.author);
      }
    }
  });

  // Convert to array with cumulative totals continuing from last known values
  const sortedDays = Array.from(dayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const newMetrics = sortedDays.map(day => {
    totalStars += day.starsAdded;
    totalForks += day.forksAdded;
    // Keep contributor count stable during incremental updates to prevent
    // cumulative inflation from re-counting previously seen contributors.
    totalContributors += 0;
    totalCommits += day.commitsAdded;
    totalIssuesOpened += day.issuesOpened;
    totalIssuesClosed += day.issuesClosed;
    totalPRsOpened += day.prsOpened;
    totalPRsClosed += day.prsClosed;
    totalPRsMerged += day.prsMerged;

    return {
      date: day.date,
      totalStars,
      totalForks,
      totalContributors,
      totalCommits,
      totalIssuesOpened,
      totalIssuesClosed,
      openIssues: totalIssuesOpened - totalIssuesClosed,
      totalPRsOpened,
      totalPRsClosed,
      totalPRsMerged,
      openPRs: totalPRsOpened - totalPRsClosed
    };
  });

  // Merge: keep existing data before sinceDate, replace/add new data
  console.log('newMetrics count:', newMetrics.length);
  console.log('newMetrics first:', newMetrics[0]?.date, 'totalStars:', newMetrics[0]?.totalStars);
  console.log('newMetrics last:', newMetrics[newMetrics.length-1]?.date, 'totalStars:', newMetrics[newMetrics.length-1]?.totalStars);
  console.log('Final result: existingBefore + newMetrics =', existingBefore.length, '+', newMetrics.length, '=', existingBefore.length + newMetrics.length);
  console.log('=== End Debug ===');
  return [...existingBefore, ...newMetrics];
}

export function aggregateToDaily(repoInfo, stargazers, forks, issues, prs, commits) {
  const startDate = new Date(repoInfo.createdAt);
  const endDate = new Date();

  // Create a map for each day
  const dayMap = new Map();

  // Initialize all days from repo creation to today
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  while (currentDate <= endDate) {
    const dateKey = currentDate.toISOString().split('T')[0];
    dayMap.set(dateKey, {
      date: dateKey,
      starsAdded: 0,
      forksAdded: 0,
      commitsAdded: 0,
      issuesOpened: 0,
      issuesClosed: 0,
      prsOpened: 0,
      prsClosed: 0,
      prsMerged: 0,
      newContributors: new Set()
    });
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Aggregate stars
  stargazers.forEach(s => {
    const dateKey = s.starredAt.split('T')[0];
    if (dayMap.has(dateKey)) {
      dayMap.get(dateKey).starsAdded++;
    }
  });

  // Aggregate forks
  forks.forEach(f => {
    const dateKey = f.createdAt.split('T')[0];
    if (dayMap.has(dateKey)) {
      dayMap.get(dateKey).forksAdded++;
    }
  });

  // Aggregate issues
  issues.forEach(i => {
    const openedDateKey = i.createdAt.split('T')[0];
    if (dayMap.has(openedDateKey)) {
      dayMap.get(openedDateKey).issuesOpened++;
    }

    if (i.closedAt) {
      const closedDateKey = i.closedAt.split('T')[0];
      if (dayMap.has(closedDateKey)) {
        dayMap.get(closedDateKey).issuesClosed++;
      }
    }
  });

  // Aggregate PRs
  prs.forEach(pr => {
    const openedDateKey = pr.createdAt.split('T')[0];
    if (dayMap.has(openedDateKey)) {
      dayMap.get(openedDateKey).prsOpened++;
    }

    if (pr.closedAt) {
      const closedDateKey = pr.closedAt.split('T')[0];
      if (dayMap.has(closedDateKey)) {
        dayMap.get(closedDateKey).prsClosed++;
      }
    }

    if (pr.mergedAt) {
      const mergedDateKey = pr.mergedAt.split('T')[0];
      if (dayMap.has(mergedDateKey)) {
        dayMap.get(mergedDateKey).prsMerged++;
      }
    }
  });

  // Track commits and unique contributors over time
  const seenContributors = new Set();
  commits.forEach(c => {
    const dateKey = c.date.split('T')[0];
    if (dayMap.has(dateKey)) {
      dayMap.get(dateKey).commitsAdded++;
      if (c.author && !seenContributors.has(c.author)) {
        seenContributors.add(c.author);
        dayMap.get(dateKey).newContributors.add(c.author);
      }
    }
  });

  // Convert to array and calculate cumulative totals
  const sortedDays = Array.from(dayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  let totalStars = 0;
  let totalForks = 0;
  let totalContributors = 0;
  let totalCommits = 0;
  let totalIssuesOpened = 0;
  let totalIssuesClosed = 0;
  let totalPRsOpened = 0;
  let totalPRsClosed = 0;
  let totalPRsMerged = 0;

  return sortedDays.map(day => {
    totalStars += day.starsAdded;
    totalForks += day.forksAdded;
    totalContributors += day.newContributors.size;
    totalCommits += day.commitsAdded;
    totalIssuesOpened += day.issuesOpened;
    totalIssuesClosed += day.issuesClosed;
    totalPRsOpened += day.prsOpened;
    totalPRsClosed += day.prsClosed;
    totalPRsMerged += day.prsMerged;

    return {
      date: day.date,
      totalStars,
      totalForks,
      totalContributors,
      totalCommits,
      totalIssuesOpened,
      totalIssuesClosed,
      openIssues: totalIssuesOpened - totalIssuesClosed,
      totalPRsOpened,
      totalPRsClosed,
      totalPRsMerged,
      openPRs: totalPRsOpened - totalPRsClosed
    };
  });
}
