/**
 * api/cron.js — Vercel Serverless Cron Endpoint
 */

const { createClient } = require('@supabase/supabase-js');

const MST_BASE = 'https://mass-shooting-tracker-data.s3.us-east-2.amazonaws.com';

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date());
}

function parseMstDate(raw) {
  if (!raw) return null;
  try {
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const d = new Date(`${raw} UTC`);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
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

    const todayRecords = allIncidents.filter(r => parseMstDate(r.date) === today);
    console.log(`[cron] ${todayRecords.length} incident(s) for ${today}`);

    if (todayRecords.length === 0) {
      // Still update last_scraped even if no incidents today
      await supabase.from('meta').upsert({ key: 'last_scraped', value: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'key', ignoreDuplicates: false });
      return res.status(200).json({ success: true, date: today, incidentsFound: 0 });
    }

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

    // Update last_scraped timestamp
    await supabase.from('meta').upsert({ key: 'last_scraped', value: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'key', ignoreDuplicates: false });

    return res.status(200).json({ success: true, date: today, incidentsFound: rows.length });

  } catch (err) {
    console.error('[cron] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
