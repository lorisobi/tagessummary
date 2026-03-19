import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TAGESSCHAU_API_URL = 'https://www.tagesschau.de/api2u/channels';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

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

        const supabase = createClient(supabaseUrl, supabaseKey);

        // --- List available Gemini models ---
        debugLogs.push('Listing available models...');
        const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const listData = await listRes.json();
        const modelNames: string[] = (listData.models || [])
            .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m: any) => m.name);
        debugLogs.push(`Available models: ${modelNames.join(', ')}`);

        // Pick a usable multimodal model (prefer flash variants)
        const preferredModel = modelNames.find(m => m.includes('flash'))
            || modelNames.find(m => m.includes('pro'))
            || modelNames[0];

        if (!preferredModel) {
            return res.status(500).json({ error: 'No usable Gemini model found for this API key.', debugLogs });
        }
        debugLogs.push(`Using model: ${preferredModel}`);

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
                message: 'VERSION 3.1 - No non-livestream video found.',
                debugLogs
            });
        }

        const itemId = videoItem.sophoraId || videoItem.externalId;
        const itemTitle = videoItem.title || 'Tagesschau';
        const itemUrl = videoItem.streams.h264s || videoItem.streams.h264m || videoItem.streams.h264xl;
        const itemDate = videoItem.date || new Date().toISOString();

        debugLogs.push(`Selected: "${itemTitle}" (${itemId})`);

        // Check duplicates
        const { data: existingData } = await supabase
            .from('tagesschau_summaries')
            .select('id')
            .eq('video_id', itemId)
            .maybeSingle();

        if (existingData) {
            return res.status(200).json({
                message: 'VERSION 3.1 - Already processed.',
                debugLogs
            });
        }

        // Download video  
        debugLogs.push(`Downloading video...`);
        const tmpPath = await downloadMedia(itemUrl, itemId);
        const fileSizeBytes = fs.statSync(tmpPath).size;
        const fileSizeMB = (fileSizeBytes / 1024 / 1024).toFixed(1);
        debugLogs.push(`Downloaded: ${fileSizeMB} MB`);

        try {
            // Encode as base64 for inline sending
            debugLogs.push(`Encoding as base64...`);
            const base64Video = fs.readFileSync(tmpPath, { encoding: 'base64' });

            // Call Gemini REST API directly (no SDK issues)
            const modelEndpoint = `https://generativelanguage.googleapis.com/v1beta/${preferredModel}:generateContent?key=${apiKey}`;
            debugLogs.push(`Calling Gemini at: ${preferredModel}:generateContent`);

            const geminiRes = await fetch(modelEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { inline_data: { mime_type: 'video/mp4', data: base64Video } },
                            { text: `Fasse diesen Nachrichtenbeitrag ("${itemTitle}") prägnant zusammen. Erstelle eine strukturierte Liste mit den wichtigsten Punkten auf Deutsch.` }
                        ]
                    }]
                })
            });

            if (!geminiRes.ok) {
                const errBody = await geminiRes.text();
                throw new Error(`Gemini API error ${geminiRes.status}: ${errBody}`);
            }

            const geminiData = await geminiRes.json();
            const summary = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            debugLogs.push(`Summary generated (${summary.length} chars).`);

            if (!summary) throw new Error('Gemini returned empty summary');

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
                message: 'VERSION 3.1 - Success!',
                videoId: itemId,
                title: itemTitle,
                debugLogs
            });

        } finally {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        }

    } catch (error: any) {
        debugLogs.push(`FATAL ERROR: ${error.message}`);
        console.error('Global Cron Error:', error);
        return res.status(500).json({ error: error.message, debugLogs });
    }
}
