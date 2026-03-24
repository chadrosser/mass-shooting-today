/**
 * api/cron.js — Vercel Serverless Cron Endpoint
 *
 * Vercel calls this daily per the schedule in vercel.json.
 * Fetches today's incidents from Mass Shooting Tracker S3 JSON
 * and upserts them into Supabase.
 *
 * Secured with CRON_SECRET env variable (set in Vercel dashboard).
 */

const { createClient } = require('@supabase/supabase-js');

const MST_BASE = 'https://mass-shooting-tracker-data.s3.us-east-2.amazonaws.com';

// Returns "YYYY-MM-DD" in Eastern Time (US-centric data source)
function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date());
}

// Parse "January 1, 2025" → "2025-01-01"
function parseMstDate(raw) {
  if (!raw) return null;
  try {
    const d = new Date(`${raw} UTC`);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  // Verify Vercel cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );

  const today = todayET();
  const year  = today.slice(0, 4);

  console.log(`[cron] Running for date: ${today}`);

  try {
    const url = `${MST_BASE}/${year}-data.json`;
    const mstRes = await fetch(url);
    if (!mstRes.ok) throw new Error(`MST fetch failed: HTTP ${mstRes.status}`);

    const allIncidents = await mstRes.json();
    if (!Array.isArray(allIncidents)) throw new Error('MST response was not an array');

    // Filter to today only
    const todayRecords = allIncidents.filter(r => parseMstDate(r.date) === today);
    console.log(`[cron] ${todayRecords.length} incident(s) for ${today}`);

    if (todayRecords.length === 0) {
      return res.status(200).json({ success: true, date: today, incidentsFound: 0 });
    }

    // Transform
    const rows = todayRecords.map(record => {
      const killed  = parseInt(record.killed)  || 0;
      const injured = parseInt(record.injured) || 0;
      return {
        date:        today,
        city:        record.city  || null,
        state:       record.state || null,
        killed,
        injured,
        description: record.description || `${killed} killed, ${injured} injured in ${record.city || 'unknown'}, ${record.state || 'unknown'}.`,
        source_url:  Array.isArray(record.sources) ? (record.sources[0] || null) : (record.sources || null),
      };
    });

    const { error } = await supabase
      .from('incidents')
      .upsert(rows, { onConflict: 'date,city,state' });

    if (error) throw new Error(`Supabase error: ${error.message}`);

    return res.status(200).json({ success: true, date: today, incidentsFound: rows.length });

  } catch (err) {
    console.error('[cron] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
