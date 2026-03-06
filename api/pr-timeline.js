// Serverless API route for PR timeline — fetches merged PRs and summarizes via Claude

import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from '@octokit/rest';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { owner, repo, githubToken } = req.body;
  if (!owner || !repo) {
    return res.status(400).json({ error: 'owner and repo are required' });
  }

  try {
    const octokit = new Octokit({ auth: githubToken || undefined });

    // Fetch closed PRs sorted by updated desc
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // Fetch merged PRs — paginate until we have enough or pass the 3-month window
    let mergedPRs = [];
    let page = 1;
    const perPage = 100;

    while (mergedPRs.length < 50) {
      const { data: prs } = await octokit.pulls.list({
        owner,
        repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: perPage,
        page,
      });

      if (prs.length === 0) break;

      for (const pr of prs) {
        if (!pr.merged_at) continue;
        if (new Date(pr.merged_at) < threeMonthsAgo) {
          // Past our window — stop
          page = Infinity;
          break;
        }
        mergedPRs.push(pr);
        if (mergedPRs.length >= 50) break;
      }

      page++;
      if (page > 10) break; // Safety cap
    }

    if (mergedPRs.length === 0) {
      return res.status(200).json({ timeline: [], truncated: false });
    }

    // Fetch per-PR details (additions/deletions) in batches of 10
    const batchSize = 10;
    const prDetails = [];

    for (let i = 0; i < mergedPRs.length; i += batchSize) {
      const batch = mergedPRs.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map(pr =>
          octokit.pulls.get({ owner, repo, pull_number: pr.number })
            .then(r => r.data)
            .catch(() => pr) // Fallback to list data if detail fetch fails
        )
      );
      prDetails.push(...details);
    }

    // Build PR list for Claude summarization
    const prList = prDetails.map(pr => ({
      number: pr.number,
      title: pr.title,
      body: (pr.body || '').slice(0, 300),
      author: pr.user?.login || 'unknown',
      mergedAt: pr.merged_at,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      url: pr.html_url,
    }));

    // Batch summarize via Claude
    const prDescriptions = prList
      .map(pr => `PR #${pr.number}: "${pr.title}" by @${pr.author}\n${pr.body ? `Description: ${pr.body}` : ''}`)
      .join('\n\n');

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Given these merged pull requests for the ${owner}/${repo} repository, return a JSON object with two fields:
1. "prs": an array of objects with "number" and "summary" fields. Each summary should be one sentence (max 20 words) written in plain, non-technical language that anyone can understand. Focus on the real-world impact on the project — what changed for users, what got better/faster/fixed, or what new capability was added. Avoid jargon like "refactor", "middleware", "API", "module", "dependency", "config" etc. Instead describe what the change actually does in human terms.
2. "overallSummary": a 2-3 sentence plain-text summary of the overall impact and direction of the project based on these PRs, written for a non-technical audience.

Only return the JSON object, nothing else.

${prDescriptions}`,
        },
      ],
    });

    const summaryText = response.content[0]?.text || '{}';
    let summaries = [];
    let overallSummary = '';
    try {
      // Extract JSON from response (handle potential markdown code blocks)
      const jsonMatch = summaryText.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      summaries = parsed.prs || [];
      overallSummary = parsed.overallSummary || '';
    } catch {
      console.error('Failed to parse summaries:', summaryText);
      // Fallback: try parsing as array (old format)
      try {
        const arrayMatch = summaryText.match(/\[[\s\S]*\]/);
        summaries = arrayMatch ? JSON.parse(arrayMatch[0]) : [];
      } catch { /* ignore */ }
    }

    // Merge summaries into PR data
    const summaryMap = new Map(summaries.map(s => [s.number, s.summary]));
    const timeline = prList.map(pr => ({
      number: pr.number,
      summary: summaryMap.get(pr.number) || pr.title,
      author: pr.author,
      mergedAt: pr.mergedAt,
      additions: pr.additions,
      deletions: pr.deletions,
      url: pr.url,
    }));

    // Sort most recent first
    timeline.sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));

    return res.status(200).json({
      timeline,
      overallSummary,
      truncated: mergedPRs.length >= 50,
    });
  } catch (error) {
    console.error('PR Timeline API error:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch PR timeline' });
  }
}
