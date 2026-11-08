-- Maison Lin — database (run once in Supabase: SQL Editor → paste → Run)
-- Tables: settings (texts, colours), products, orders, admins. Storage bucket: garments (public read).

create extension if not exists pgcrypto;

-- who may use /admin (add yourself after your first sign-in: see SETUP.md)
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- one row per setting: announcement, hero texts, colours, delivery…
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists products (
  id text primary key,                    -- slug, e.g. le-pull-onyx-cacao
  name text not null,
  color text default '',
  hex text default '#8a6a55',
  price integer not null check (price >= 0),          -- euros
  category text default 'knitwear',                   -- knitwear | hoodies | polos | …
  base text default 'knit',                           -- 3D template family: knit | hoodie | hoodie-pocket | polo
  line text default 'Atelier',
  description text default '',
  details jsonb default '[]',
  badge text default '',
  visible boolean default true,
  sort integer default 100,
  stock jsonb default '{}',                           -- {"S": 3, "M": 0} — empty = always available
  status text default 'processing' check (status in ('processing', 'ready', 'failed')),
  front_url text, back_url text,                      -- the two photos
  glb_url text, texture_url text, fabric_url text,    -- the built 3D piece
  model jsonb default '{}',                           -- rig proportions written by the builder
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  number serial,
  status text default 'pending' check (status in ('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded')),
  items jsonb not null,                               -- [{id, name, color, size, qty, price}]
  subtotal integer, discount integer default 0, shipping integer default 0, total integer,
  currency text default 'eur',
  email text, name text, phone text,
  address jsonb,
  stripe_session text unique,
  tracking text, note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists t_products on products; create trigger t_products before update on products for each row execute function touch();
drop trigger if exists t_orders on orders; create trigger t_orders before update on orders for each row execute function touch();
drop trigger if exists t_settings on settings; create trigger t_settings before update on settings for each row execute function touch();

-- ---------------- row level security ----------------
alter table admins enable row level security;
alter table settings enable row level security;
alter table products enable row level security;
alter table orders enable row level security;

drop policy if exists "admins read self" on admins;
create policy "admins read self" on admins for select using (user_id = auth.uid() or is_admin());
drop policy if exists "admins manage" on admins;
create policy "admins manage" on admins for all using (is_admin()) with check (is_admin());

drop policy if exists "settings public read" on settings;
create policy "settings public read" on settings for select using (true);
drop policy if exists "settings admin write" on settings;
create policy "settings admin write" on settings for all using (is_admin()) with check (is_admin());

drop policy if exists "products public read" on products;
create policy "products public read" on products for select using ((visible and status = 'ready') or is_admin());
drop policy if exists "products admin write" on products;
create policy "products admin write" on products for all using (is_admin()) with check (is_admin());

-- orders are written by the checkout / webhook functions (service role); admins read and update them
drop policy if exists "orders admin" on orders;
create policy "orders admin" on orders for all using (is_admin()) with check (is_admin());

-- ---------------- storage: photos and 3D files ----------------
insert into storage.buckets (id, name, public) values ('garments', 'garments', true)
on conflict (id) do update set public = true;

drop policy if exists "garments public read" on storage.objects;
create policy "garments public read" on storage.objects for select using (bucket_id = 'garments');
drop policy if exists "garments admin write" on storage.objects;
create policy "garments admin write" on storage.objects for insert with check (bucket_id = 'garments' and is_admin());
drop policy if exists "garments admin update" on storage.objects;
create policy "garments admin update" on storage.objects for update using (bucket_id = 'garments' and is_admin());
drop policy if exists "garments admin delete" on storage.objects;
create policy "garments admin delete" on storage.objects for delete using (bucket_id = 'garments' and is_admin());

-- ---------------- defaults ----------------
insert into settings (key, value) values
  ('store', '{"name": "Maison Lin", "currency": "eur", "freeShipping": 300, "shippingFee": 12, "email": ""}'),
  ('announce', '["Complimentary delivery over €300", "Free returns within 30 days", "Try every piece on with your camera", "Gift wrapping on request"]'),
  ('hero', '{"eyebrow": "Autumn — Winter 2026", "title": "Quiet pieces,", "titleItalic": "made to be worn.", "sub": "Drag or scroll along the rail. Choose a piece, turn it in your hands, then try it on with your camera."}'),
  ('theme', '{"bg": "#E8DDD0", "ink": "#2E2019", "accent": "#A26E3F", "cream": "#F5EFE6"}'),
  ('promo', '{"WELCOME10": 10}')
on conflict (key) do nothing;
