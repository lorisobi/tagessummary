import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  try {
    let supabaseUrl = process.env.SUPABASE_URL || '';
    if (supabaseUrl && !supabaseUrl.startsWith('http')) supabaseUrl = `https://${supabaseUrl}`;
    const supabaseKey = process.env.SUPABASE_KEY || '';
    console.log('[Supabase/videos] URL present:', !!supabaseUrl, '| URL value:', supabaseUrl);
    console.log('[Supabase/videos] KEY present:', !!supabaseKey, '| KEY length:', supabaseKey.length);

    if (!supabaseUrl || !supabaseKey) {
        throw new Error("Supabase credentials are not configured in Environment Variables.");
    }

    console.log('[Supabase/videos] Creating client...');
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Supabase/videos] Client created. Querying tagesschau_summaries...');

    const { data, error } = await supabase
      .from('tagesschau_summaries')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(20);
    console.log('[Supabase/videos] Query result count:', data?.length ?? 'null', '| error:', error);

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
