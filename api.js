require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function getToday() {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('date', today);

  if (error) {
    console.error('Error fetching incidents:', error);
    return null;
  }

  return {
    date: today,
    hadShooting: data.length > 0,
    incidents: data
  };
}

module.exports = { getToday };