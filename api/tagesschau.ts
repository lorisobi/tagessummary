import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/files';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TAGESSCHAU_API_URL = 'https://www.tagesschau.de/api2u/channels';

// Helfer-Funktion: Direkte Datei (MP4) herunterladen
async function downloadDirectMedia(url: string, id: string): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), `ts_${id.replace(/[^a-z0-9]/gi, '_')}.mp4`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(arrayBuffer));
    return tmpPath;
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

    const itemsToProcess: any[] = [];
    const debugLogs: string[] = [];

    // --- Fetch Tagesschau API (100 Sekunden) ---
    try {
        debugLogs.push(`Fetching ${TAGESSCHAU_API_URL}...`);
        const tsRes = await fetch(TAGESSCHAU_API_URL);
        const tsData = await tsRes.json();
        const channels = tsData.channels || [];
        debugLogs.push(`Found ${channels.length} channels.`);
        
        // Log all titles for debugging
        channels.forEach((c: any, i: number) => {
            debugLogs.push(`Channel ${i}: "${c.title}" (ID: ${c.sophoraId})`);
        });

        // Wir suchen den ersten Channel, der kein Livestream ist (identifizierbar an h264-Streams)
        const item100s = channels.find((c: any) => 
            c.streams && (c.streams.h264s || c.streams.h264m || c.streams.h264xl)
        );
        
        if (item100s) {
            debugLogs.push(`Found 100s item: ${item100s.sophoraId || item100s.externalId}`);
            if (item100s.streams && item100s.streams.h264s) {
                itemsToProcess.push({
                    id: item100s.sophoraId || item100s.externalId,
                    title: 'Tagesschau in 100 Sekunden',
                    pubDate: item100s.date || new Date().toISOString(),
                    source: 'tagesschau_api',
                    url: item100s.streams.h264s || item100s.streams.h264m || item100s.streams.h264xl,
                    type: 'video/mp4'
                });
            } else {
                debugLogs.push('100s item has no h264s stream.');
            }
        } else {
            debugLogs.push('Program "tagesschau_in_100_Sekunden" not found in channels.');
        }
    } catch (e: any) {
        debugLogs.push(`Tagesschau API fetch failed: ${e.message}`);
        console.error('Tagesschau API fetch failed', e);
    }

    debugLogs.push(`Items to process: ${itemsToProcess.length}`);
    const results = [];

    for (const item of itemsToProcess) {
      // Check if already processed
      const { data: existingData } = await supabase
        .from('tagesschau_summaries')
        .select('id')
        .eq('video_id', item.id)
        .maybeSingle();

      if (existingData) {
        results.push({ id: item.id, status: 'skipped', reason: 'already processed' });
        continue;
      }

      let tmpPath = null;
      let uploadResponse = null;
      
      try {
        // Download
        tmpPath = await downloadDirectMedia(item.url, item.id);

        // Upload to Gemini
        uploadResponse = await fileManager.uploadFile(tmpPath, {
            mimeType: item.type,
            displayName: item.title,
        });

        // Summarize with fallbacks
        const modelNames = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-flash-001", "gemini-1.5-flash-002", "gemini-pro-vision"];
        let responseText = "";
        let errorMsg = "";

        for (const modelName of modelNames) {
            try {
                debugLogs.push(`Trying model ${modelName}...`);
                const model = genAI.getGenerativeModel({ model: modelName }); 
                const prompt = `Fasse diesen Nachrichtenbeitrag ("${item.title}") prägnant zusammen. Erstelle eine strukturierte Liste mit den wichtigsten Punkten.`;
                
                const response = await model.generateContent([
                    { fileData: { mimeType: uploadResponse.file.mimeType, fileUri: uploadResponse.file.uri } } as any,
                    { text: prompt }
                ]);
                
                responseText = response.response.text();
                debugLogs.push(`Successfully summarized with ${modelName}.`);
                break;
            } catch (modelErr: any) {
                errorMsg = modelErr.message;
                debugLogs.push(`Model ${modelName} failed: ${modelErr.message}`);
            }
        }

        if (!responseText) throw new Error(`All Gemini models failed. Last error: ${errorMsg}`);
        
        const summary = responseText;

        // Save
        const { error: insertError } = await supabase
          .from('tagesschau_summaries')
          .insert({
            video_id: item.id,
            title: item.title,
            source: item.source,
            published_at: item.pubDate,
            summary: summary,
          });

        if (insertError) throw insertError;
        results.push({ id: item.id, status: 'success' });

      } catch (err: any) {
        console.error(`Error processing ${item.id}:`, err);
        results.push({ id: item.id, status: 'error', reason: err.message });
      } finally {
        if (uploadResponse?.file) await fileManager.deleteFile(uploadResponse.file.name).catch(() => {});
        if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      }
    }

    return res.status(200).json({ 
        message: 'VERSION 2.2 - News Summarizer Running!',
        results, 
        debugLogs 
    });

  } catch (error: any) {
    console.error('Global Cron Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
