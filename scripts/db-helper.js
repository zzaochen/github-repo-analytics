#!/usr/bin/env node
// Helper script to manage Supabase data via REST API
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://brelelsghtiqdnlisaro.supabase.co';
const supabaseKey = 'sb_publishable_XYSLVORTtH_3cKFMpESEqg_YMC-bl67';
const supabase = createClient(supabaseUrl, supabaseKey);

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (command) {
    case 'list-repos':
      const { data: repos } = await supabase.from('repositories').select('*');
      console.table(repos);
      break;

    case 'delete-repo':
      const [owner, repo] = args[0]?.split('/') || [];
      if (!owner || !repo) {
        console.log('Usage: node db-helper.js delete-repo owner/repo');
        return;
      }
      const { data: repoData } = await supabase
        .from('repositories')
        .select('id')
        .eq('owner', owner)
        .eq('repo', repo)
        .single();

      if (repoData) {
        await supabase.from('daily_metrics').delete().eq('repo_id', repoData.id);
        await supabase.from('repositories').delete().eq('id', repoData.id);
        console.log(`Deleted ${owner}/${repo}`);
      } else {
        console.log('Repo not found');
      }
      break;

    case 'show-columns':
      const tableName = args[0] || 'repositories';
      // This requires a workaround since we can't query information_schema with anon key
      const { data: sample } = await supabase.from(tableName).select('*').limit(1);
      if (sample?.[0]) {
        console.log(`Columns in ${tableName}:`, Object.keys(sample[0]));
      }
      break;

    default:
      console.log(`
Available commands:
  list-repos              - List all cached repositories
  delete-repo owner/repo  - Delete a repo and its metrics
  show-columns [table]    - Show columns for a table
      `);
  }
}

main().catch(console.error);
