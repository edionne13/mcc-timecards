create table if not exists public.google_email_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  google_email text not null,
  refresh_token_ciphertext text not null,
  connected_by uuid not null references public.profiles(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_email_connections enable row level security;
revoke all on public.google_email_connections from anon, authenticated;
