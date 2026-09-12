CREATE TABLE public.mcp_servers (
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

CREATE TABLE public.app_preferences (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

GRANT ALL ON public.app_preferences TO service_role;
ALTER TABLE public.app_preferences ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER mcp_servers_updated_at BEFORE UPDATE ON public.mcp_servers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();