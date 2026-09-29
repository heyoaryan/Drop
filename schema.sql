-- =========================================================
-- DROP - SUPABASE DATABASE & STORAGE SCHEMA
-- Run this in your Supabase SQL Editor (Dashboard -> SQL Editor)
-- =========================================================

-- 1. Create drop_items table for shared messages and files
create table if not exists public.drop_items (
  id uuid primary key default gen_random_uuid(),
  session_code text not null,
  kind text not null check (kind in ('text', 'image', 'file')),
  text text,
  name text,
  url text,
  storage_path text,
  size bigint default 0,
  created_at timestamptz default now()
);

-- 2. Fast query indexing by session and time
create index if not exists idx_drop_items_session 
  on public.drop_items(session_code, created_at asc);

-- 3. Enable Row Level Security (RLS)
alter table public.drop_items enable row level security;

-- Drop existing policies if re-running to avoid conflicts
drop policy if exists "Allow public select on drop_items" on public.drop_items;
drop policy if exists "Allow public insert on drop_items" on public.drop_items;
drop policy if exists "Allow public delete on drop_items" on public.drop_items;

-- Open policies for room-based access
create policy "Allow public select on drop_items"
  on public.drop_items for select using (true);

create policy "Allow public insert on drop_items"
  on public.drop_items for insert with check (true);

create policy "Allow public delete on drop_items"
  on public.drop_items for delete using (true);

-- 4. Enable Supabase Realtime for instant synchronization
alter table public.drop_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'drop_items'
  ) then
    alter publication supabase_realtime add table public.drop_items;
  end if;
end $$;

-- 5. Create public storage bucket for photos and PDFs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'drop_files', 
  'drop_files', 
  true,
  52428800, -- 50 MB limit
  null
)
on conflict (id) do update set public = true;

-- Drop existing storage policies if re-running
drop policy if exists "Allow public view drop_files" on storage.objects;
drop policy if exists "Allow public upload drop_files" on storage.objects;
drop policy if exists "Allow public delete drop_files" on storage.objects;

-- Storage policies for the bucket
create policy "Allow public view drop_files"
  on storage.objects for select
  using (bucket_id = 'drop_files');

create policy "Allow public upload drop_files"
  on storage.objects for insert
  with check (bucket_id = 'drop_files');

create policy "Allow public delete drop_files"
  on storage.objects for delete
  using (bucket_id = 'drop_files');
