/**
 * api/cron.js — Vercel Serverless Cron Endpoint
 * Data source: Gun Violence Archive (gunviolencearchive.org)
 */

const { createClient } = require('@supabase/supabase-js');

const GVA_URL = 'https://www.gunviolencearchive.org/reports/mass-shooting';

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date());
}

// Converts "March 29, 2026" to "2026-03-29"
function parseGvaDate(raw) {
  if (!raw) return null;
  try {
    const d = new Date(`${raw.trim()} UTC`);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

async function scrapeGva() {
  const res = await fetch(GVA_URL, {
    headers: {
      // Identify ourselves honestly per GVA's mission statement
      'User-Agent': 'wasthereamassshootingtoday.com/cron (non-commercial public awareness site; contact: rosserchad@gmail.com)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`GVA fetch failed: HTTP ${res.status}`);

  const html = await res.text();

  // Parse tbody rows from the incidents table
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) throw new Error('Could not find tbody in GVA response');

  const tbody = tbodyMatch[1];
  const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  const incidents = [];

  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m =>
      m[1].replace(/<[^>]+>/g, '').trim()
    );

    // Column order per GVA table:
    // 0: IncidentID
    // 1: IncidentDate
    // 2: State
    // 3: CityOrCounty
    // 4: Address
    // 5: NumberOfVictimsKilled
    // 6: NumberOfVictimsInjured
    // 7: NumberOfPerpertratorsKilled
    // 8: NumberOfPerpertratorsInjured
    // 9: NumberOfPerpertratorsArrested
    // 10: Operations (links)

    if (cells.length < 7) continue;

    const [
      incidentId,
      rawDate,
      state,
      city,
      address,
      rawKilled,
      rawInjured,
    ] = cells;

    const date = parseGvaDate(rawDate);
    if (!date) continue;

    incidents.push({
      date,
      city:    city  || null,
      state:   state || null,
      killed:  parseInt(rawKilled)  || 0,
      injured: parseInt(rawInjured) || 0,
      address: address || null,
      source_url: GVA_URL,
      description: null, // GVA table doesn't include a description field
    });
  }

  return incidents;
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
  console.log(`[cron] Running for date: ${today}`);

  try {
    const allIncidents = await scrapeGva();
    console.log(`[cron] ${allIncidents.length} total incident(s) scraped from GVA`);

    const todayRecords = allIncidents.filter(r => r.date === today);
    console.log(`[cron] ${todayRecords.length} incident(s) for ${today}`);

    if (todayRecords.length === 0) {
      await supabase
        .from('meta')
        .upsert(
          { key: 'last_scraped', value: new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'key', ignoreDuplicates: false }
        );
      return res.status(200).json({ success: true, date: today, incidentsFound: 0 });
    }

    const rows = todayRecords.map(record => ({
      date:        record.date,
      city:        record.city,
      state:       record.state,
      killed:      record.killed,
      injured:     record.injured,
      description: record.description || `${record.killed} killed, ${record.injured} injured in ${record.city || 'unknown'}, ${record.state || 'unknown'}.`,
      source_url:  record.source_url,
    }));

    const { error } = await supabase
      .from('incidents')
      .upsert(rows, { onConflict: 'date,city,state', ignoreDuplicates: false });

    if (error) throw new Error(`Supabase error: ${error.message}`);

    await supabase
      .from('meta')
      .upsert(
        { key: 'last_scraped', value: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'key', ignoreDuplicates: false }
      );

    return res.status(200).json({ success: true, date: today, incidentsFound: rows.length });

  } catch (err) {
    console.error('[cron] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
