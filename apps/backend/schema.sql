-- GostMood Creative Lab — Supabase / PostgreSQL schema
-- Run this whole script in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null unique,
  role text not null default 'buyer' check (role in ('buyer','seller','admin')),
  avatar text not null default '',
  store_name text not null default '',
  store_description text not null default '',
  seller_approved boolean not null default false,
  earnings numeric(12,2) not null default 0,
  privacy_accepted_at timestamptz,
  privacy_policy_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists privacy_accepted_at timestamptz;
alter table public.profiles add column if not exists privacy_policy_version text;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email, role, store_name, privacy_accepted_at, privacy_policy_version)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    case when new.raw_user_meta_data ->> 'role' = 'seller' then 'seller' else 'buyer' end,
    coalesce(new.raw_user_meta_data ->> 'store_name', new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'privacy_accepted_at', '')::timestamptz,
    nullif(new.raw_user_meta_data ->> 'privacy_policy_version', '')
  ) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  price numeric(12,2) not null check (price >= 0),
  category text not null check (category in ('instrumental','equipment','instrument')),
  subcategory text not null default '',
  image text not null default '',
  stock integer not null default 1 check (stock >= 0),
  is_digital boolean not null default false,
  genre text not null default '',
  bpm integer,
  musical_key text not null default '',
  license text not null default 'Basique',
  audio_preview text not null default '',
  brand text not null default '',
  rating numeric(3,2) not null default 0,
  num_reviews integer not null default 0,
  is_featured boolean not null default false,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_category_idx on public.products(category);
create index if not exists products_seller_idx on public.products(seller_id);
create index if not exists products_approved_created_idx on public.products(is_approved, created_at desc);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  unique(product_id, user_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  shipping_address jsonb not null default '{}'::jsonb,
  payment_method text not null default 'simulation',
  items_price numeric(12,2) not null,
  shipping_price numeric(12,2) not null default 0,
  total_price numeric(12,2) not null,
  is_paid boolean not null default false,
  paid_at timestamptz,
  is_delivered boolean not null default false,
  delivered_at timestamptz,
  status text not null default 'pending' check (status in ('pending','processing','shipped','delivered','cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists orders_buyer_idx on public.orders(buyer_id, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  seller_id uuid not null references public.profiles(id),
  name text not null,
  image text not null default '',
  price numeric(12,2) not null,
  quantity integer not null check (quantity > 0),
  is_digital boolean not null default false
);
create index if not exists order_items_seller_idx on public.order_items(seller_id);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  subtitle text not null default '',
  image text not null default '',
  link text not null default '',
  badge text not null default '',
  badge_color text not null default '#f59e0b',
  cta text not null default 'Voir l’offre',
  approved boolean not null default false,
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  last_message text not null default '',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(buyer_id, seller_id, product_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(trim(content)) > 0),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);

-- Create an order using authoritative product prices and atomic inventory updates.
create or replace function public.place_market_order(
  p_buyer_id uuid,
  p_shipping_address jsonb,
  p_payment_method text,
  p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_order_id uuid := gen_random_uuid();
  item jsonb;
  product_row public.products%rowtype;
  item_total numeric(12,2) := 0;
  shipping_total numeric(12,2) := 0;
  has_physical boolean := false;
  quantity_value integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Le panier est vide';
  end if;

  -- Validate all requested quantities/products first; row locks prevent overselling.
  for item in select value from jsonb_array_elements(p_items) loop
    quantity_value := (item ->> 'quantity')::integer;
    if quantity_value < 1 then raise exception 'Quantité invalide'; end if;
    select * into product_row from public.products
      where id = (item ->> 'productId')::uuid and is_approved = true for update;
    if not found then raise exception 'Produit indisponible'; end if;
    if not product_row.is_digital and product_row.stock < quantity_value then
      raise exception 'Stock insuffisant pour %', product_row.name;
    end if;
    item_total := item_total + product_row.price * quantity_value;
    if not product_row.is_digital then has_physical := true; end if;
  end loop;

  if has_physical and item_total < 50 then shipping_total := 5.99; end if;
  insert into public.orders (id, buyer_id, shipping_address, payment_method, items_price, shipping_price, total_price)
    values (new_order_id, p_buyer_id, coalesce(p_shipping_address, '{}'::jsonb), coalesce(p_payment_method, 'simulation'), item_total, shipping_total, item_total + shipping_total);

  for item in select value from jsonb_array_elements(p_items) loop
    quantity_value := (item ->> 'quantity')::integer;
    select * into product_row from public.products where id = (item ->> 'productId')::uuid for update;
    insert into public.order_items (order_id, product_id, seller_id, name, image, price, quantity, is_digital)
      values (new_order_id, product_row.id, product_row.seller_id, product_row.name, product_row.image, product_row.price, quantity_value, product_row.is_digital);
    if not product_row.is_digital then
      update public.products set stock = stock - quantity_value where id = product_row.id;
    end if;
  end loop;
  return new_order_id;
end;
$$;

create or replace function public.cancel_market_order(p_order_id uuid, p_buyer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  order_row public.orders%rowtype;
  item_row public.order_items%rowtype;
begin
  select * into order_row from public.orders where id = p_order_id for update;
  if not found or order_row.buyer_id <> p_buyer_id then raise exception 'Commande introuvable'; end if;
  if order_row.status not in ('pending', 'processing') then raise exception 'Annulation impossible'; end if;
  for item_row in select * from public.order_items where order_id = p_order_id loop
    if not item_row.is_digital and item_row.product_id is not null then
      update public.products set stock = stock + item_row.quantity where id = item_row.product_id;
    end if;
  end loop;
  update public.orders set status = 'cancelled' where id = p_order_id;
end;
$$;

revoke all on function public.place_market_order(uuid, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_market_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.place_market_order(uuid, jsonb, text, jsonb) to service_role;
grant execute on function public.cancel_market_order(uuid, uuid) to service_role;

-- The app accesses data only through FastAPI using the server-side service key.
-- Keep RLS enabled; service_role bypasses RLS. Do not put the service key in the frontend.
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.reviews enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.announcements enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
