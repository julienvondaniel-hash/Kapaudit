-- =============================================================================
-- Kapaudit — Migration : essai gratuit de 30 jours
-- À exécuter APRÈS schema.sql (idempotent : re-jouable sans risque).
-- Supabase → SQL Editor → New query → coller ci-dessous → Run.
-- =============================================================================

-- 1) Colonne d'essai sur les profils (les lignes existantes reçoivent la valeur
--    par défaut = maintenant + 30 jours au moment de l'ALTER).
alter table public.profiles
  add column if not exists trial_ends_at timestamptz not null default (now() + interval '30 days');

-- 2) Création d'un dossier :
--    - pendant l'essai (< trial_ends_at) : GRATUIT, aucun crédit consommé ;
--    - après l'essai : consomme 1 crédit (atomique) ; sinon erreur 'ACCES_REQUIS'.
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

-- 3) État d'accès de l'utilisateur courant (pour le tableau de bord) :
--    { trial_ends_at, trial_active, credits }.
create or replace function public.access_status()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'trial_ends_at', (select trial_ends_at from public.profiles where id = auth.uid()),
    'trial_active',  (select (trial_ends_at > now()) from public.profiles where id = auth.uid()),
    'credits',       public.credit_balance(auth.uid())
  );
$$;

-- (Rappel) offrir des crédits de test à un utilisateur, depuis le SQL Editor :
--   insert into public.credit_ledger(owner, delta, reason) values ('<uuid_user>', 3, 'offert');
