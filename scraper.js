/**
 * scraper.js — Mass Shooting Tracker → Supabase
 *
 * Usage:
 *   node scraper.js              → imports current year
 *   node scraper.js --backfill   → imports 2013 through current year
 *   node scraper.js --year 2023  → imports a specific year
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MST_BASE = 'https://mass-shooting-tracker-data.s3.us-east-2.amazonaws.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Parse MST date strings → "YYYY-MM-DD"
// MST currently uses ISO format: "2025-01-01T00:00:00.000Z"
// Also handles legacy format: "January 1, 2025"
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

function transform(record) {
  const date = parseMstDate(record.date);
  if (!date) {
    console.warn(`  ⚠ Skipping unparseable date: "${record.date}"`);
    return null;
  }

  const source_url = Array.isArray(record.sources)
    ? (record.sources[0] || null)
    : (record.sources || null);

  const killed  = parseInt(record.killed)  || 0;
  const injured = parseInt(record.injured) || 0;

  return {
    date,
    city:        record.city        || null,
    state:       record.state       || null,
    killed,
    injured,
    description: record.description || `${killed} killed, ${injured} injured in ${record.city || 'unknown'}, ${record.state || 'unknown'}.`,
    source_url,
  };
}

// Deduplicate rows by (date, city, state) — MST data sometimes has duplicates
// within the same year file which causes PostgreSQL upsert to fail
function deduplicate(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = `${row.date}|${row.city}|${row.state}`;
    if (!seen.has(key)) {
      seen.set(key, row);
    }
  }
  return Array.from(seen.values());
}

// ─── Fetch + import one year ───────────────────────────────────────────────────

async function importYear(year) {
  const url = `${MST_BASE}/${year}-data.json`;
  console.log(`\n📥 Fetching ${year} from MST…`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`Unexpected response for ${year}`);

  console.log(`   ${raw.length} records found`);

  const transformed = raw.map(transform).filter(Boolean);
  const rows = deduplicate(transformed);

  const dupeCount = transformed.length - rows.length;
  console.log(`   ${rows.length} valid rows after transform${dupeCount > 0 ? ` (${dupeCount} duplicates removed)` : ''}`);

  let upserted = 0;
  let errored  = 0;
  const BATCH  = 200;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('incidents')
      .upsert(batch, { onConflict: 'date,city,state', ignoreDuplicates: false })
      .select('id');

    if (error) {
      console.error(`   ❌ Supabase error on batch ${i}–${i + batch.length}:`, error.message);
      errored += batch.length;
    } else {
      upserted += data?.length ?? batch.length;
      process.stdout.write(`   ✓ Rows ${i + 1}–${Math.min(i + BATCH, rows.length)} upserted\r`);
    }
  }

  console.log(`\n   ✅ ${year}: ${upserted} upserted, ${errored} errors`);
  return { year, upserted, errored };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in .env');
    process.exit(1);
  }

  const args        = process.argv.slice(2);
  const currentYear = new Date().getFullYear();
  let years         = [currentYear];

  if (args.includes('--backfill')) {
    years = Array.from({ length: currentYear - 2013 + 1 }, (_, i) => 2013 + i);
    console.log(`🔄 Backfill mode: importing ${years[0]}–${years.at(-1)}`);
  } else if (args.includes('--year')) {
    const y = parseInt(args[args.indexOf('--year') + 1]);
    if (isNaN(y) || y < 2013 || y > currentYear) {
      console.error(`❌ Invalid year. Must be 2013–${currentYear}`);
      process.exit(1);
    }
    years = [y];
    console.log(`📅 Single year mode: ${y}`);
  } else {
    console.log(`📅 Default mode: importing current year (${currentYear})`);
  }

  const results = [];
  for (const year of years) {
    try {
      results.push(await importYear(year));
    } catch (err) {
      console.error(`\n❌ Failed ${year}: ${err.message}`);
      results.push({ year, upserted: 0, errored: -1 });
    }
  }

  console.log('\n─── Summary ───────────────────────────────');
  for (const { year, upserted, errored } of results) {
    const status = errored === -1 ? 'FETCH FAILED' : `${upserted} upserted, ${errored} errors`;
    console.log(`  ${year}: ${status}`);
  }
  console.log('────────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
