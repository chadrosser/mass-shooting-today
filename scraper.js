require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function scrape() {
  console.log('Starting scrape...');

  try {
    const { data } = await axios.get(
      'https://www.gunviolencearchive.org/reports/mass-shooting',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }
      }
    );

    const $ = cheerio.load(data);
    const today = new Date().toISOString().split('T')[0];
    const incidents = [];

    $('table tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      const rawDate = $(cells[0]).text().trim();
      const state   = $(cells[1]).text().trim();
      const city    = $(cells[2]).text().trim();
      const killed  = parseInt($(cells[3]).text().trim()) || 0;
      const injured = parseInt($(cells[4]).text().trim()) || 0;
      const sourceUrl = $(cells[5]).find('a').attr('href') || '';

      // Normalize date from MM/DD/YYYY to YYYY-MM-DD
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

    console.log(`Found ${incidents.length} incident(s) for ${today}`);

    if (incidents.length > 0) {
      const { error } = await supabase
        .from('incidents')
        .upsert(incidents, { onConflict: 'date,city,state' });

      if (error) {
        console.error('Supabase error:', error);
      } else {
        console.log('✓ Saved to database successfully!');
      }
    } else {
      console.log('No incidents today — database unchanged.');
    }

  } catch (err) {
    console.error('Scrape failed:', err.message);
  }
}

scrape();