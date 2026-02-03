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

  // Track unique contributors over time
  const seenContributors = new Set();
  commits.forEach(c => {
    if (!c.author) return;
    const dateKey = c.date.split('T')[0];
    if (dayMap.has(dateKey) && !seenContributors.has(c.author)) {
      seenContributors.add(c.author);
      dayMap.get(dateKey).newContributors.add(c.author);
    }
  });

  // Convert to array and calculate cumulative totals
  const sortedDays = Array.from(dayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  let totalStars = 0;
  let totalForks = 0;
  let totalContributors = 0;
  let totalIssuesOpened = 0;
  let totalIssuesClosed = 0;
  let totalPRsOpened = 0;
  let totalPRsClosed = 0;
  let totalPRsMerged = 0;

  return sortedDays.map(day => {
    totalStars += day.starsAdded;
    totalForks += day.forksAdded;
    totalContributors += day.newContributors.size;
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
