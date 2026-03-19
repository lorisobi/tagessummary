import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TAGESSCHAU_API_URL = 'https://www.tagesschau.de/api2u/channels';

// Download a direct MP4 file to /tmp
async function downloadMedia(url: string, id: string): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), `ts_${id.replace(/[^a-z0-9]/gi, '_')}.mp4`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(arrayBuffer));
    return tmpPath;
}

export default async function handler(req: any, res: any) {
  const debugLogs: string[] = [];
  
  try {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    
    let supabaseUrl = process.env.SUPABASE_URL || '';
    if (supabaseUrl && !supabaseUrl.startsWith('http')) supabaseUrl = `https://${supabaseUrl}`;
    const supabaseKey = process.env.SUPABASE_KEY || '';
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials missing');

    // New SDK: GoogleGenAI
    const ai = new GoogleGenAI({ apiKey });
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- Fetch Tagesschau API ---
    debugLogs.push(`Fetching ${TAGESSCHAU_API_URL}...`);
    const tsRes = await fetch(TAGESSCHAU_API_URL);
    const tsData = await tsRes.json();
    const channels = tsData.channels || [];
    debugLogs.push(`Found ${channels.length} channels.`);

    channels.forEach((c: any, i: number) => {
        debugLogs.push(`Channel ${i}: "${c.title}" (sophoraId: ${c.sophoraId})`);
    });

    // Find first non-livestream video (has direct h264 streams)
    const videoItem = channels.find((c: any) => 
        c.streams && (c.streams.h264s || c.streams.h264m || c.streams.h264xl)
    );

    if (!videoItem) {
        return res.status(200).json({ 
            message: 'VERSION 3.0 - No non-livestream video found.', 
            debugLogs 
        });
    }

    const itemId = videoItem.sophoraId || videoItem.externalId;
    const itemTitle = videoItem.title || 'Tagesschau';
    const itemUrl = videoItem.streams.h264s || videoItem.streams.h264m || videoItem.streams.h264xl;
    const itemDate = videoItem.date || new Date().toISOString();

    debugLogs.push(`Selected: "${itemTitle}" (${itemId}) → ${itemUrl}`);

    // Check duplicates
    const { data: existingData } = await supabase
        .from('tagesschau_summaries')
        .select('id')
        .eq('video_id', itemId)
        .maybeSingle();

    if (existingData) {
        return res.status(200).json({ 
            message: 'VERSION 3.0 - Already processed.', 
            debugLogs 
        });
    }

    // Download video  
    debugLogs.push(`Downloading video...`);
    const tmpPath = await downloadMedia(itemUrl, itemId);
    const fileSizeBytes = fs.statSync(tmpPath).size;
    debugLogs.push(`Downloaded: ${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`);

    let uploadedFile: any = null;
    try {
        // Upload to Gemini File API (new SDK)
        debugLogs.push(`Uploading to Gemini Files API...`);
        uploadedFile = await ai.files.upload({
            file: tmpPath,
            config: { mimeType: 'video/mp4', displayName: itemTitle }
        });
        debugLogs.push(`Uploaded: ${uploadedFile.uri}`);

        // Wait for file to be processed (ACTIVE state)
        let fileStatus = uploadedFile;
        let attempts = 0;
        while (fileStatus.state === 'PROCESSING' && attempts < 10) {
            await new Promise(r => setTimeout(r, 3000));
            fileStatus = await ai.files.get({ name: fileStatus.name });
            attempts++;
            debugLogs.push(`File state: ${fileStatus.state} (attempt ${attempts})`);
        }
        if (fileStatus.state !== 'ACTIVE') {
            throw new Error(`File processing failed. Final state: ${fileStatus.state}`);
        }

        // Summarize with Gemini
        debugLogs.push(`Generating summary...`);
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: [
                {
                    parts: [
                        { fileData: { fileUri: uploadedFile.uri, mimeType: 'video/mp4' } },
                        { text: `Fasse diesen Nachrichtenbeitrag ("${itemTitle}") prägnant zusammen. Erstelle eine strukturierte Liste mit den wichtigsten Punkten auf Deutsch.` }
                    ]
                }
            ]
        });

        const summary = response.text ?? '';
        debugLogs.push(`Summary generated (${summary.length} chars).`);

        // Save to Supabase
        const { error: insertError } = await supabase
            .from('tagesschau_summaries')
            .insert({
                video_id: itemId,
                title: itemTitle,
                source: 'tagesschau_api',
                published_at: itemDate,
                summary,
            });

        if (insertError) throw insertError;
        debugLogs.push(`Saved to Supabase!`);

        return res.status(200).json({
            message: 'VERSION 3.0 - Success!',
            videoId: itemId,
            title: itemTitle,
            debugLogs
        });

    } finally {
        // Cleanup Gemini file
        if (uploadedFile?.name) {
            await ai.files.delete({ name: uploadedFile.name }).catch(() => {});
        }
        // Cleanup local temp file
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }

  } catch (error: any) {
    debugLogs.push(`FATAL ERROR: ${error.message}`);
    console.error('Global Cron Error:', error);
    return res.status(500).json({ error: error.message, debugLogs });
  }
}
