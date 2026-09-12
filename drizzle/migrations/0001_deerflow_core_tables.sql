CREATE TABLE IF NOT EXISTS public.memories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  importance INT NOT NULL DEFAULT 1,
  vector_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.memories TO service_role;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.scheduled_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  instruction TEXT NOT NULL,
  cron TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.scheduled_tasks TO service_role;
ALTER TABLE public.scheduled_tasks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.media_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.media_assets TO service_role;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mcp_servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  transport text not null default 'http',
  active boolean not null default true,
  last_error text,
  tool_names text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT ALL ON public.mcp_servers TO service_role;
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.app_preferences (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
GRANT ALL ON public.app_preferences TO service_role;
ALTER TABLE public.app_preferences ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_memories_updated_at ON public.memories;
CREATE TRIGGER update_memories_updated_at BEFORE UPDATE ON public.memories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheduled_tasks_updated_at ON public.scheduled_tasks;
CREATE TRIGGER update_scheduled_tasks_updated_at BEFORE UPDATE ON public.scheduled_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS mcp_servers_updated_at ON public.mcp_servers;
CREATE TRIGGER mcp_servers_updated_at BEFORE UPDATE ON public.mcp_servers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
