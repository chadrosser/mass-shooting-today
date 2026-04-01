/**
 * api/today.js — Vercel Serverless Endpoint
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date());
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const today = todayET();

  // Today's incidents
  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('date', today);

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  // Last scrape time from meta table
  const { data: metaRow } = await supabase
    .from('meta')
    .select('value')
    .eq('key', 'last_scraped')
    .single();

  // Most recent shooting date (for NO days)
  const { data: lastShootingRow } = await supabase
    .from('incidents')
    .select('date')
    .lt('date', today)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  return res.status(200).json({
    date:             today,
    hadShooting:      data.length > 0,
    incidents:        data,
    lastUpdated:      metaRow?.value || null,
    lastShootingDate: lastShootingRow?.date || null,
  });
};
