const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = async (req, res) => {
  // Secure the endpoint so only Vercel can trigger it
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: html } = await axios.get(
      'https://www.gunviolencearchive.org/reports/mass-shooting',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }
      }
    );

    const $ = cheerio.load(html);
    const today = new Date().toISOString().split('T')[0];
    const incidents = [];

    $('table tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      const rawDate = $(cells[0]).text().trim();
      const state = $(cells[1]).text().trim();
      const city = $(cells[2]).text().trim();
      const killed = parseInt($(cells[3]).text().trim()) || 0;
      const injured = parseInt($(cells[4]).text().trim()) || 0;
      const sourceUrl = $(cells[5]).find('a').attr('href') || '';

      const parts = rawDate.split('/');
      if (parts.length === 3) {
        const normalized = `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
        if (normalized === today) {
          incidents.push({
            date: normalized,
            city,
            state,
            killed,
            injured,
            source_url: sourceUrl,
            description: `${killed} killed, ${injured} injured in ${city}, ${state}.`
          });
        }
      }
    });

    if (incidents.length > 0) {
      const { error } = await supabase
        .from('incidents')
        .upsert(incidents, { onConflict: 'date,city,state' });

      if (error) throw error;
    }

    return res.status(200).json({
      success: true,
      date: today,
      incidentsFound: incidents.length
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};