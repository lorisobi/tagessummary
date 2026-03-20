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
        console.log('[Supabase] URL present:', !!supabaseUrl, '| URL value:', supabaseUrl);
        console.log('[Supabase] KEY present:', !!supabaseKey, '| KEY length:', supabaseKey.length);
        if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials missing');

        console.log('[Supabase] Creating client...');
        const supabase = createClient(supabaseUrl, supabaseKey);
        console.log('[Supabase] Client created.');

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

        // Find items with video streams, excluding livestreams
        const rawVideoItems = channels.filter((c: any) =>
            c.streams && (c.streams.h264s || c.streams.h264m || c.streams.h264xl) &&
            !(c.title || '').toLowerCase().includes('livestream')
        );

        // Deduplicate by video URL within this run
        const videoItems: any[] = [];
        const seenUrls = new Set<string>();
        for (const item of rawVideoItems) {
            const url = item.streams.h264s || item.streams.h264m || item.streams.h264xl;
            if (!seenUrls.has(url)) {
                seenUrls.add(url);
                videoItems.push(item);
            }
        }

        if (videoItems.length === 0) {
            return res.status(200).json({
                message: 'VERSION 3.3 - No new video items found.',
                debugLogs
            });
        }

        debugLogs.push(`Found ${videoItems.length} unique video items. Processing up to 5.`);

        const processedItems: any[] = [];
        const limit = 5;
        const itemsToProcess = videoItems.slice(0, limit);

        for (const videoItem of itemsToProcess) {
            const itemId = videoItem.sophoraId || videoItem.externalId;
            const itemTitle = videoItem.title || 'Tagesschau';
            const itemUrl = videoItem.streams.h264s || videoItem.streams.h264m || videoItem.streams.h264xl;
            const itemDate = videoItem.date || new Date().toISOString();

            debugLogs.push(`--- Processing: "${itemTitle}" (${itemId}) ---`);

            // Check duplicates
            const { data: existingData, error: existingError } = await supabase
                .from('tagesschau_summaries')
                .select('id')
                .eq('video_id', itemId)
                .maybeSingle();

            if (existingData) {
                debugLogs.push(`Skipping: Already processed.`);
                continue;
            }

            // Download video
            let currentTmpPath = '';
            try {
                currentTmpPath = await downloadMedia(itemUrl, itemId);
                const fileSizeBytes = fs.statSync(currentTmpPath).size;
                debugLogs.push(`Downloaded: ${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`);

                // Encode as base64
                const base64Video = fs.readFileSync(currentTmpPath, { encoding: 'base64' });

                // Call Gemini
                const modelEndpoint = `https://generativelanguage.googleapis.com/v1beta/${preferredModel}:generateContent?key=${apiKey}`;
                const geminiRes = await fetch(modelEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            role: 'user',
                            parts: [
                                { inline_data: { mime_type: 'video/mp4', data: base64Video } },
                                { text: `Analysiere diesen Tagesschau-Beitrag ("${itemTitle}") und erstelle:
1. Eine prägnante Zusammenfassung im Markdown-Format (Fettmarkierungen für wichtige Begriffe, Aufzählungen).
2. Das wörtliche Transkript (den gesprochenen Text) des Beitrags.

Antworte bitte EXAKT in diesem Format:
[SUMMARY]
(Hier die Zusammenfassung)

[TRANSCRIPT]
(Hier das wörtliche Transkript)` }
                            ]
                        }]
                    })
                });

                if (!geminiRes.ok) {
                    const errBody = await geminiRes.text();
                    throw new Error(`Gemini API error ${geminiRes.status}: ${errBody}`);
                }

                const geminiData = await geminiRes.json();
                const aiResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                
                if (!aiResponse) throw new Error('Gemini returned empty response');
                
                // Split summary and transcript
                const parts = aiResponse.split('[TRANSCRIPT]');
                const summary = parts[0].replace('[SUMMARY]', '').trim();
                const transcript = parts[1] ? parts[1].trim() : '';

                // Extract URL from tracking (Nielsen p5)
                const nielsen = videoItem.tracking?.find((t: any) => t.c5 && t.c5.startsWith('p5,'));
                const webUrl = nielsen ? nielsen.c5.split(',')[1] : 'https://www.tagesschau.de/';

                // Save to Supabase
                const { error: insertError } = await supabase
                    .from('tagesschau_summaries')
                    .insert({
                        video_id: itemId,
                        title: itemTitle,
                        source: 'tagesschau_api',
                        published_at: itemDate,
                        summary,
                        transcript,
                        url: webUrl
                    });

                if (insertError) throw insertError;
                debugLogs.push(`Saved to Supabase!`);
                processedItems.push({ id: itemId, title: itemTitle });

            } catch (itemError: any) {
                debugLogs.push(`Error processing item ${itemId}: ${itemError.message}`);
                console.error(`Item Error (${itemId}):`, itemError);
            } finally {
                if (currentTmpPath && fs.existsSync(currentTmpPath)) fs.unlinkSync(currentTmpPath);
            }
        }

        return res.status(200).json({
            message: `VERSION 3.2 - Processed ${processedItems.length} new items.`,
            processedItems,
            debugLogs
        });

    } catch (error: any) {
        debugLogs.push(`FATAL ERROR: ${error.message}`);
        console.error('Global Cron Error:', error);
        return res.status(500).json({ error: error.message, debugLogs });
    }
}
