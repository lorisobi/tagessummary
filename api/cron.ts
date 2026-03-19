import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';
import { YoutubeTranscript } from 'youtube-transcript';

// Initialize clients
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const TAGESSCHAU_PLAYLIST_ID = 'PL4A2F331EE86DCC22';
const RSS_FEED_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${TAGESSCHAU_PLAYLIST_ID}`;

export default async function handler(req: any, res: any) {
  try {
    // 1. Fetch latest videos from RSS
    const parser = new Parser();
    const feed = await parser.parseURL(RSS_FEED_URL);
    
    if (!feed.items || feed.items.length === 0) {
      return res.status(200).json({ message: 'No videos found in playlist.' });
    }

    // We only process the most recent video
    const latestVideo = feed.items[0];
    const videoId = latestVideo.id.replace('yt:video:', '');
    const title = latestVideo.title;
    const publishedAt = latestVideo.pubDate || new Date().toISOString();

    // 2. Check if already processed in Supabase
    const { data: existingData, error: dbError } = await supabase
      .from('tagesschau_summaries')
      .select('id')
      .eq('video_id', videoId)
      .maybeSingle();

    if (existingData) {
      return res.status(200).json({ message: `Video ${videoId} already processed.` });
    }

    // 3. Fetch transcript
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    const fullTranscript = transcriptItems.map(t => t.text).join(' ');

    if (!fullTranscript || fullTranscript.length === 0) {
        return res.status(500).json({ error: 'Failed to extract transcript.' });
    }

    // 4. Summarize with Gemini
    const prompt = `Fasse die folgenden Nachrichten der Tagesschau prägnant und übersichtlich in Stichpunkten zusammen. Markiere die wichtigsten Themen klar:\n\n${fullTranscript}`;
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    
    const summary = response.text;

    // 5. Store in Supabase
    const { error: insertError } = await supabase
      .from('tagesschau_summaries')
      .insert({
        video_id: videoId,
        title: title,
        published_at: publishedAt,
        summary: summary,
      });

    if (insertError) {
      throw insertError;
    }

    return res.status(200).json({ 
        message: 'Successfully processed and summarized new Tagesschau video.',
        videoId: videoId
    });

  } catch (error: any) {
    console.error('Error processing cronjob:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
