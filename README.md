# Tagesschau Summarizer Cronjob

Dieses Projekt ist ein serverseitiger Cronjob für Vercel, der automatisch die neuesten Videos der Tagesschau-Playlist abruft, die Untertitel extrahiert, diese mit Google Gemini zusammenfasst und in einer Supabase Datenbank speichert.

## Vorbereitungen

### 1. Supabase einrichten
Führe das beiliegende SQL-Skript im Supabase SQL Editor aus, um die benötigte Tabelle zu erstellen:
\`\`\`sql
-- Siehe schema.sql
CREATE TABLE IF NOT EXISTS tagesschau_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

### 2. Environment Variables setzen (Vercel)
Setze in Vercel folgende Umgebungsvariablen für dein Projekt:
- `SUPABASE_URL`: URL deiner Supabase-Instanz.
- `SUPABASE_KEY`: Der `anon` oder `service_role` Key für deine Supabase Datenbank.
- `GEMINI_API_KEY`: API Key von Google Gemini.

### 3. Vercel Deployment
Das Projekt kann direkt in Vercel importiert werden. Durch die \`vercel.json\` ist der Cronjob automatisch konfiguriert und wird nach Deployment stündlich (zur vollen Stunde) ausgeführt.

## Testen
Um den Cronjob manuell in Vercel auszulösen, nutze den Vercel Dashboard Bereich **Settings -> Cron Jobs** oder rufe den Endpoint in der Entwicklung manuell auf.
