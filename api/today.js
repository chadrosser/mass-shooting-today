const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('date', today);

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  // Get year-to-date count
  const { count } = await supabase
    .from('incidents')
    .select('*', { count: 'exact', head: true })
    .gte('date', `${new Date().getFullYear()}-01-01`);

return res.status(200).json({
    date: today,
    hadShooting: data.length > 0,
    incidents: data,
    ytdCount: count || 0,
    lastUpdated: new Date().toISOString()
  });
};