import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';
import { YoutubeTranscript } from 'youtube-transcript';

const TAGESSCHAU_PLAYLIST_ID = 'PL4A2F331EE86DCC22';
const RSS_FEED_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${TAGESSCHAU_PLAYLIST_ID}`;

export default async function handler(req: any, res: any) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    
    let supabaseUrl = process.env.SUPABASE_URL || '';
    if (supabaseUrl && !supabaseUrl.startsWith('http')) supabaseUrl = `https://${supabaseUrl}`;
    const supabaseKey = process.env.SUPABASE_KEY || '';
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials missing');

    const genAI = new GoogleGenerativeAI(apiKey);
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch latest videos from RSS
    const parser = new Parser();
    const feed = await parser.parseURL(RSS_FEED_URL);
    
    if (!feed.items || feed.items.length === 0) {
      return res.status(200).json({ message: 'No videos found in playlist.' });
    }

    // Process the 2 most recent videos
    const latestVideos = feed.items.slice(0, 2);
    const results = [];

    for (const video of latestVideos) {
      const videoId = video.id.replace('yt:video:', '');
      const title = video.title;
      const publishedAt = video.pubDate || new Date().toISOString();

      // 2. Check if already processed in Supabase
      const { data: existingData, error: dbError } = await supabase
        .from('tagesschau_summaries')
        .select('id')
        .eq('video_id', videoId)
        .maybeSingle();

      if (existingData) {
        results.push({ videoId, status: 'skipped', reason: 'already processed' });
        continue;
      }

      try {
        // 3. Fetch transcript
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
        const fullTranscript = transcriptItems.map((t: any) => t.text).join(' ');

        if (!fullTranscript || fullTranscript.length === 0) {
            results.push({ videoId, status: 'error', reason: 'Failed to extract transcript' });
            continue;
        }

        // 4. Summarize with Gemini
        const prompt = `Fasse die folgenden Nachrichten der Tagesschau prägnant und übersichtlich in Stichpunkten zusammen. Markiere die wichtigsten Themen klar:\n\n${fullTranscript}`;
        
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const response = await model.generateContent(prompt);
        const summary = response.response.text();

        // 5. Store in Supabase
        const { error: insertError } = await supabase
          .from('tagesschau_summaries')
          .insert({
            video_id: videoId,
            title: title || 'Kein Titel',
            published_at: publishedAt,
            summary: summary,
          });

        if (insertError) {
          throw insertError;
        }

        results.push({ videoId, status: 'success' });
      } catch (err: any) {
        console.error(`Error processing video ${videoId}:`, err);
        results.push({ videoId, status: 'error', reason: err.message });
      }
    }

    return res.status(200).json({ 
        message: 'Cronjob execution finished.',
        results: results
    });

  } catch (error: any) {
    console.error('Error processing cronjob:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
