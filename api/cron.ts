import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';

const TAGESSCHAU_PLAYLIST_ID = 'PL4A2F331EE86DCC22';
const RSS_FEED_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${TAGESSCHAU_PLAYLIST_ID}`;

// Native Transcript Fetcher to avoid ESM package errors on Vercel
async function fetchTranscript(videoId: string): Promise<string> {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    }
  });
  const html = await response.text();
  
  // Extract the internal YouTube JSON object from the page HTML
  const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var\s+(?:meta|head)|<\/script|\n)/);
  if (!playerResponseMatch) throw new Error('Player response not found on YouTube page');
  
  const playerResponse = JSON.parse(playerResponseMatch[1]);
  const tracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  
  if (!tracks || tracks.length === 0) throw new Error('No transcripts available for this video');
  
  // Try to find German captions, otherwise take the first available
  let track = tracks.find((t: any) => t.languageCode === 'de');
  if (!track) track = tracks[0];

  const transcriptResponse = await fetch(track.baseUrl);
  const xml = await transcriptResponse.text();

  // Extract all <text>...</text> tags from the XML using Regex
  const textLines = [];
  const regex = /<text[^>]*>([^<]+)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
      // Decode basic HTML entities and add to lines
      const decodedText = match[1]
          .replace(/&amp;/g, '&')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"');
      textLines.push(decodedText);
  }
  
  return textLines.join(' ');
}

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
        // 3. Fetch transcript natively
        const fullTranscript = await fetchTranscript(videoId);

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
