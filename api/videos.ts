import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req: any, res: any) {
  try {
    const { data, error } = await supabase
      .from('tagesschau_summaries')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(20);

    if (error) {
      throw error;
    }

    // CORS headers for local testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

    return res.status(200).json({ videos: data });
  } catch (error: any) {
    console.error('Error fetching videos:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
