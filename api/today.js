/**
 * api/today.js — Vercel Serverless Endpoint
 *
 * Returns today's incident data from Supabase.
 * Called by the frontend on page load.
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Use Eastern Time so "today" matches the US-centric MST data source.
// Without this, UTC would flip to the next day at 8pm ET, showing
// an empty database and incorrectly answering "NO" each evening.
function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date());
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const today = todayET();

  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('date', today);

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  // Year-to-date count
  const { count } = await supabase
    .from('incidents')
    .select('*', { count: 'exact', head: true })
    .gte('date', `${today.slice(0, 4)}-01-01`);

  return res.status(200).json({
    date:        today,
    hadShooting: data.length > 0,
    incidents:   data,
    ytdCount:    count || 0,
    lastUpdated: new Date().toISOString(),
  });
};
