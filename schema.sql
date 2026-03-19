-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS tagesschau_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
