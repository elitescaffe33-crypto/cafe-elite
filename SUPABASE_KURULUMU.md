# Supabase kalici veritabani kurulumu

Bu kurulum admin ayarlarini ve order history kayitlarini kalici hale getirir.

## 1. Supabase projesi

1. `https://supabase.com` adresinde hesap ac.
2. New project olustur.
3. Proje acildiktan sonra sol menuden `SQL Editor` bolumune gir.

## 2. SQL tablo kurulumu

SQL Editor icine sunu yapistir ve calistir:

```sql
create table if not exists public.cafe_elite_settings (
  id text primary key,
  settings jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cafe_elite_orders (
  id text primary key,
  created_at timestamptz not null default now(),
  type text not null,
  payment text not null,
  status text not null,
  stripe_session_id text,
  amount text,
  customer_name text,
  phone text,
  email text,
  collection_time text,
  items text,
  notes text,
  message text
);

create index if not exists cafe_elite_orders_created_at_idx
  on public.cafe_elite_orders (created_at desc);
```

## 3. API bilgileri

Supabase projesinde:

1. `Project Settings`
2. `API`
3. `Project URL` degerini kopyala.
4. `service_role` secret key degerini kopyala.

## 4. Render Environment Variables

Render > cafe-elite > Environment icine sunlari ekle:

```text
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key_buraya
```

Kaydet ve sonra:

```text
Manual Deploy -> Deploy latest commit
```

## Not

`SUPABASE_SERVICE_ROLE_KEY` gizlidir. GitHub'a veya site dosyalarina yazma.

