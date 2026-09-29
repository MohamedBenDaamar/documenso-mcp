-- One Documenso team API token per signed-in user, encrypted by the MCP server before it is stored.
-- The MCP server reads and writes this table only with the user's own access token (no service role key),
-- so row level security is the boundary between users.

create table public.documenso_connections (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- AES-256-GCM ciphertext produced by the MCP server, bound to user_id. Supabase never sees the plaintext.
  token_ciphertext text not null check (token_ciphertext like 'v1.%'),
  -- Last four characters of the token, shown so users can tell which token is linked.
  token_hint text not null check (char_length(token_hint) = 4),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documenso_connections enable row level security;

revoke all on table public.documenso_connections from anon;
revoke all on table public.documenso_connections from authenticated;
grant select, insert, update, delete on table public.documenso_connections to authenticated;

create policy "Users read their own connection"
  on public.documenso_connections for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their own connection"
  on public.documenso_connections for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their own connection"
  on public.documenso_connections for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their own connection"
  on public.documenso_connections for delete to authenticated
  using ((select auth.uid()) = user_id);

create function public.touch_documenso_connection() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger documenso_connections_touch
  before update on public.documenso_connections
  for each row execute function public.touch_documenso_connection();
