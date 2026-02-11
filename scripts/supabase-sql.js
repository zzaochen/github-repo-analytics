#!/usr/bin/env node
// Run SQL commands against Supabase using the JS client
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://brelelsghtiqdnlisaro.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_XYSLVORTtH_3cKFMpESEqg_YMC-bl67';

const supabase = createClient(supabaseUrl, supabaseKey);

const sql = process.argv.slice(2).join(' ');

if (!sql) {
  console.log('Usage: node supabase-sql.js "SELECT * FROM table"');
  process.exit(1);
}

async function runQuery() {
  try {
    // For SELECT queries, we can use the REST API
    if (sql.toLowerCase().startsWith('select')) {
      const tableName = sql.match(/from\s+(\w+)/i)?.[1];
      if (tableName) {
        const { data, error } = await supabase.from(tableName).select('*').limit(100);
        if (error) throw error;
        console.log(JSON.stringify(data, null, 2));
        return;
      }
    }

    // For other queries, we need the service role key or use RPC
    console.log('Note: DDL/DML commands require service role key or must be run in Supabase dashboard');
    console.log('SQL to run:', sql);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

runQuery();
