import { GoogleGenerativeAI, Part } from '@google/generative-ai';
// @ts-ignore - Some environments have issues with the subpath types, but the package exports it
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TAGESSCHAU_PLAYLIST_ID = 'PL4A2F331EE86DCC22';
const RSS_FEED_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${TAGESSCHAU_PLAYLIST_ID}`;

// Helfer-Funktion: Audio auf Vercel /tmp herunterladen
async function downloadAudioToTmp(videoId: string): Promise<string> {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const tmpPath = path.join(os.tmpdir(), `${videoId}.m4a`);
    
    return new Promise((resolve, reject) => {
        // filter for audio only, lowest quality is enough for Gemini speech recognition
        const stream = ytdl(url, { quality: 'lowestaudio', filter: 'audioonly' });
        const writeStream = fs.createWriteStream(tmpPath);
        
        stream.pipe(writeStream);
        
        writeStream.on('finish', () => resolve(tmpPath));
        stream.on('error', reject);
        writeStream.on('error', reject);
    });
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
    const fileManager = new GoogleAIFileManager(apiKey);
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
      const { data: existingData } = await supabase
        .from('tagesschau_summaries')
        .select('id')
        .eq('video_id', videoId)
        .maybeSingle();

      if (existingData) {
        results.push({ videoId, status: 'skipped', reason: 'already processed' });
        continue;
      }

      let tmpAudioPath = null;
      let uploadResponse = null;
      
      try {
        // 3. Download Audio to Vercel /tmp directory
        console.log(`Downloading audio for ${videoId}...`);
        tmpAudioPath = await downloadAudioToTmp(videoId);

        // 4. Upload to Gemini
        console.log(`Uploading audio ${videoId} to Gemini...`);
        uploadResponse = await fileManager.uploadFile(tmpAudioPath, {
            mimeType: 'audio/mp4', // m4a is essentially an audio/mp4 container
            displayName: `Tagesschau Audio ${videoId}`,
        });

        // 5. Summarize with Gemini natively processing the Audio
        console.log(`Summarizing audio ${videoId} via Gemini 1.5...`);
        const prompt = `Fasse die Nachrichten dieser Audiospur der Tagesschau prägnant und übersichtlich in Stichpunkten zusammen. Markiere die wichtigsten Themen klar.`;
        
        // Gemini 1.5 models possess multimodal audio analysis capabilities
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 
        const response = await model.generateContent([
            {
              fileData: {
                  mimeType: uploadResponse.file.mimeType,
                  fileUri: uploadResponse.file.uri
              }
            } as any,
            { text: prompt }
        ]);
        
        const summary = response.response.text();

        // 6. Store in Supabase
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
      } finally {
        // Always clean up Google Cloud file
        if (uploadResponse && uploadResponse.file) {
            try {
                await fileManager.deleteFile(uploadResponse.file.name);
            } catch (gcErr) {
                console.error('Failed to clear Gemini file:', gcErr);
            }
        }
        
        // Always clean up Vercel temp file
        if (tmpAudioPath && fs.existsSync(tmpAudioPath)) {
            try {
                fs.unlinkSync(tmpAudioPath);
            } catch (cleanupErr) {
                console.error('Failed to block-cleanup temp file:', cleanupErr);
            }
        }
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
