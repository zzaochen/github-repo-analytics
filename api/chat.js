// Serverless API route for AI chat — uses Claude tool-use to query Supabase

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

export const config = {
  maxDuration: 60
};

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const DATABASE_SCHEMA = `Available database tables and columns:

- repositories: id, owner, repo, created_at, last_fetched, company_name, company_url
- daily_metrics: id, repo_id (FK→repositories.id), date, total_stars, total_forks, total_contributors, total_issues_opened, total_issues_closed, total_prs_opened, total_prs_closed, total_prs_merged, total_commits
- monthly_metrics: id, repo_id (FK→repositories.id), month_end, stars_at_month_end, stars_mom_change, stars_mom_growth_pct, forks_at_month_end, forks_mom_change, forks_mom_growth_pct, issues_opened_at_month_end, issues_opened_mom_change, issues_opened_mom_growth_pct, prs_opened_at_month_end, prs_opened_mom_change, prs_opened_mom_growth_pct, contributors_at_month_end, contributors_mom_change, contributors_mom_growth_pct
- milestone_events: id, repo_id (FK→repositories.id), milestone_type (e.g. "stars_5k", "stars_10k", "stars_25k", "stars_50k", "stars_100k"), milestone_value (integer, e.g. 5000, 10000, 25000, 50000, 100000), stars_at_crossing, crossed_at (date)`;

const ALLOWED_TABLES = ['repositories', 'daily_metrics', 'monthly_metrics', 'milestone_events'];

const ALLOWED_OPERATORS = {
  eq: 'eq',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  in: 'in',
  ilike: 'ilike',
};

const QUERY_TOOL = {
  name: 'query_database',
  description: 'Query the GitHub analytics database. Use this to look up repository metrics, growth data, milestones, and more. You can call this tool multiple times to gather data from different tables before answering.',
  input_schema: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        enum: ALLOWED_TABLES,
        description: 'The database table to query.',
      },
      select: {
        type: 'string',
        description: 'Comma-separated list of columns to return, or "*" for all columns.',
        default: '*',
      },
      filters: {
        type: 'array',
        description: 'Filters to apply to the query.',
        items: {
          type: 'object',
          properties: {
            column: { type: 'string', description: 'Column name to filter on.' },
            operator: {
              type: 'string',
              enum: Object.keys(ALLOWED_OPERATORS),
              description: 'Comparison operator.',
            },
            value: {
              description: 'Value to compare against. Use an array for the "in" operator.',
            },
          },
          required: ['column', 'operator', 'value'],
        },
        default: [],
      },
      order_by: {
        type: 'string',
        description: 'Column to order by. Prefix with "-" for descending order (e.g. "-total_stars").',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of rows to return (default 50, max 200).',
        default: 50,
        maximum: 200,
      },
    },
    required: ['table'],
  },
};

// Execute a query_database tool call against Supabase
async function executeQuery(supabase, input) {
  const { table, select = '*', filters = [], order_by, limit = 50 } = input;

  if (!ALLOWED_TABLES.includes(table)) {
    return { error: `Invalid table: ${table}` };
  }

  const clampedLimit = Math.min(Math.max(1, limit), 200);

  let query = supabase.from(table).select(select);

  for (const filter of filters) {
    const op = ALLOWED_OPERATORS[filter.operator];
    if (!op) {
      return { error: `Invalid operator: ${filter.operator}` };
    }
    query = query[op](filter.column, filter.value);
  }

  if (order_by) {
    const descending = order_by.startsWith('-');
    const column = descending ? order_by.slice(1) : order_by;
    query = query.order(column, { ascending: !descending });
  }

  query = query.limit(clampedLimit);

  const { data, error } = await query;

  if (error) {
    return { error: error.message };
  }

  return { data, count: data.length };
}

const SYSTEM_PROMPT = `You are an AI assistant for a GitHub Repository Analytics dashboard. You help users understand data about their tracked GitHub repositories.

Today's date is ${new Date().toISOString().split('T')[0]}.

IMPORTANT: You MUST use the query_database tool to look up data before answering any question about repositories, stars, forks, growth, milestones, or metrics. You do NOT have any data in this prompt — the only way to get data is by calling the tool. Never say "I don't have data" — instead, query for it.

${DATABASE_SCHEMA}

Querying tips:
- To find a specific repo, query the repositories table first (you can filter with ilike on owner or repo columns), then use its id to query metrics tables via the repo_id column.
- For "which repo has the most stars", query daily_metrics ordered by -total_stars with limit 1, then look up the repo name from repositories.
- For growth questions, query monthly_metrics and order by the relevant _mom_change or _mom_growth_pct column.
- You can make multiple tool calls in a single turn to gather all the data you need before responding.
- Be efficient: aim to answer in 1-2 tool call rounds. Do not keep searching iteratively — get what you need and respond.
- Do NOT include partial answers alongside tool calls. Only provide your complete answer after you have all the data you need. Never say things like "Let me look that up" or "Here are the results:" while still making tool calls.

Response guidelines:
- Do NOT use markdown bold (**text**) or any other markdown formatting. Use plain text only.
- Always refer to repositories in owner/repo format (e.g., facebook/react).
- Keep responses concise but informative. Use bullet points for comparisons.
- Format numbers with commas for readability (e.g., 12,345 stars).
- If asked about a repo that isn't tracked, suggest the user add it via the Repo Lookup page.`;

const MAX_TOOL_ITERATIONS = 4;

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

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const { message, history } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    // Build messages array from history
    const messages = [];
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: message });

    const client = new Anthropic({ apiKey });

    // Tool-use loop: let Claude query the database as needed
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [QUERY_TOOL],
        messages,
      });

      // Check if Claude used any tools
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      // If no tool calls, Claude is done — extract text and return
      if (toolUseBlocks.length === 0) {
        const textBlock = response.content.find(b => b.type === 'text');
        const assistantMessage = textBlock?.text || 'No response generated.';
        return res.status(200).json({ response: assistantMessage });
      }

      console.log(`[chat] iteration ${i + 1}: ${toolUseBlocks.length} tool call(s)`);

      // Keep full response content (including any text) in messages —
      // the API requires the complete content array to maintain context
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool call and collect results
      const toolResults = [];
      for (const block of toolUseBlocks) {
        const result = await executeQuery(supabase, block.input);
        console.log(`[chat]   tool: ${block.input.table}, filters: ${JSON.stringify(block.input.filters || [])}, results: ${result.count ?? 0}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      // Add tool results as a user message for the next iteration
      messages.push({ role: 'user', content: toolResults });
    }

    // Exhausted iterations — ask Claude to summarize with what it has
    messages.push({ role: 'user', content: 'Please provide your final answer now using the data you have already gathered. Do not make any more tool calls.' });

    const finalResponse = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    const textBlock = finalResponse.content.find(b => b.type === 'text');
    return res.status(200).json({ response: textBlock?.text || 'No response generated.' });
  } catch (error) {
    console.error('Chat API error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate response' });
  }
}
