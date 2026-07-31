-- =============================================================================
-- Kapaudit — Schéma Supabase (PostgreSQL)
-- À coller dans Supabase → SQL Editor → New query → Run.
-- Idempotent au niveau des tables/policies (drop policy if exists avant create).
-- Choix : dossiers CLOISONNÉS par conseiller (RLS sur owner) ; 1 dossier = 1 crédit.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1) Profils (une ligne par utilisateur, créée automatiquement à l'inscription)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  stripe_customer_id text,
  trial_ends_at      timestamptz not null default (now() + interval '30 days'),  -- essai gratuit 30 jours
  created_at         timestamptz not null default now()
);
-- Ajout de la colonne d'essai si la table existait déjà (re-run idempotent).
alter table public.profiles add column if not exists trial_ends_at timestamptz not null default (now() + interval '30 days');
alter table public.profiles enable row level security;
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2) Grand livre des crédits-dossiers (append-only = auditable)
--    +N à l'achat, -1 à la création d'un dossier.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id         bigint generated always as identity primary key,
  owner      uuid not null references auth.users(id) on delete cascade,
  delta      int  not null,
  reason     text not null,          -- 'achat' | 'creation_dossier' | 'remboursement' | 'offert'
  ref        text,                   -- id session Stripe (achat) ou id étude (création)
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_owner_idx on public.credit_ledger(owner, created_at);
alter table public.credit_ledger enable row level security;
drop policy if exists ledger_select_own on public.credit_ledger;
create policy ledger_select_own on public.credit_ledger for select using (owner = auth.uid());
-- Aucune policy insert/update/delete : écrit UNIQUEMENT via fonctions SECURITY DEFINER
-- (create_etude) et via le webhook (clé service_role) — jamais directement par le client.

create or replace function public.credit_balance(uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from public.credit_ledger where owner = uid;
$$;

-- ---------------------------------------------------------------------------
-- 3) Paiements Stripe (idempotence : une session ne crédite qu'une fois)
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id                 bigint generated always as identity primary key,
  owner              uuid not null references auth.users(id) on delete cascade,
  stripe_session_id  text unique not null,
  amount_cents       int,
  currency           text,
  credits            int not null default 0,
  created_at         timestamptz not null default now()
);
alter table public.payments enable row level security;
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments for select using (owner = auth.uid());

-- Enregistre un achat de façon ATOMIQUE et IDEMPOTENTE (appelée par le webhook,
-- via la clé service_role). Renvoie true si les crédits ont été ajoutés (1re fois),
-- false si la session avait déjà été traitée.
create or replace function public.record_purchase(
  p_owner uuid, p_credits int, p_session text, p_amount int, p_currency text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_inserted int;
begin
  insert into public.payments(owner, stripe_session_id, amount_cents, currency, credits)
  values (p_owner, p_session, p_amount, p_currency, p_credits)
  on conflict (stripe_session_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;               -- déjà traité
  insert into public.credit_ledger(owner, delta, reason, ref)
  values (p_owner, p_credits, 'achat', p_session);
  return true;
end; $$;

-- ---------------------------------------------------------------------------
-- 4) Études (dossiers) — cloisonnées par conseiller
-- ---------------------------------------------------------------------------
create table if not exists public.etudes (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client     text,
  titre      text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists etudes_owner_idx on public.etudes(owner, updated_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists etudes_touch on public.etudes;
create trigger etudes_touch before update on public.etudes
  for each row execute procedure public.touch_updated_at();

alter table public.etudes enable row level security;
drop policy if exists etudes_select_own on public.etudes;
drop policy if exists etudes_update_own on public.etudes;
drop policy if exists etudes_delete_own on public.etudes;
create policy etudes_select_own on public.etudes for select using (owner = auth.uid());
create policy etudes_update_own on public.etudes for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy etudes_delete_own on public.etudes for delete using (owner = auth.uid());
-- PAS de policy INSERT : la création passe par create_etude() (consomme 1 crédit).

-- Création d'un dossier :
--   - pendant l'essai gratuit (< trial_ends_at) : GRATUIT, aucun crédit consommé ;
--   - après l'essai : consomme 1 crédit (atomique) ; sinon erreur ACCES_REQUIS.
create or replace function public.create_etude(p_client text, p_titre text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_bal int; v_trial boolean;
begin
  if auth.uid() is null then raise exception 'NON_AUTHENTIFIE'; end if;
  select (trial_ends_at > now()) into v_trial from public.profiles where id = auth.uid();
  v_trial := coalesce(v_trial, false);
  select public.credit_balance(auth.uid()) into v_bal;
  if (not v_trial) and v_bal < 1 then
    raise exception 'ACCES_REQUIS';   -- essai terminé ET aucun crédit
  end if;
  insert into public.etudes(owner, client, titre, data)
    values (auth.uid(), p_client, p_titre, coalesce(p_data, '{}'::jsonb))
    returning id into v_id;
  if not v_trial then                 -- hors essai : on débite 1 crédit
    insert into public.credit_ledger(owner, delta, reason, ref)
      values (auth.uid(), -1, 'creation_dossier', v_id::text);
  end if;
  return v_id;
end; $$;

-- État d'accès de l'utilisateur courant (pour le tableau de bord) :
-- { trial_ends_at, trial_active, credits }.
create or replace function public.access_status()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'trial_ends_at', (select trial_ends_at from public.profiles where id = auth.uid()),
    'trial_active',  (select (trial_ends_at > now()) from public.profiles where id = auth.uid()),
    'credits',       public.credit_balance(auth.uid())
  );
$$;

-- (Optionnel) offrir des crédits de test à un utilisateur, depuis le SQL Editor :
--   insert into public.credit_ledger(owner, delta, reason) values ('<uuid_user>', 3, 'offert');
