# HEXA — Mise en place de l'application SaaS (multi-utilisateurs, payante)

Produit : générer des **audits patrimoniaux** (PowerPoint + livret) à la demande.
**Modèle : 1 dossier = 50 € HT ; génération PPTX/livret illimitée** pour un dossier payé.

**Architecture**
```
Navigateur ──► Vercel (front-end statique + fonctions /api)
                    │            │
                    │            ├─► Supabase  : Auth (login/mdp sécurisés) + base PostgreSQL (UE)
                    │            └─► Stripe    : paiement 50 € HT / crédit-dossier
                    └─► Supabase Auth (session JWT)
```
Principe des crédits : l'utilisateur **achète des crédits-dossiers** (50 € HT l'unité, à
l'unité ou par lot) ; **créer un dossier consomme 1 crédit** (opération atomique côté base) ;
**générer autant de PPTX/livrets que voulu est gratuit** (le rendu se fait dans le navigateur).

> ⚠️ On n'écrit **jamais** de table « mots de passe » soi-même : **Supabase Auth** hache et
> gère les identifiants. On ne met **jamais** de clé secrète (Stripe `sk_...`, Supabase
> `service_role`) dans le front-end — uniquement dans les variables d'environnement Vercel.

Légende : **[VOUS]** = à faire par vous · **[MOI]** = codé/fourni par l'assistant.

---

## Phase A — Supabase (Auth + base)

### A.1 Créer le projet  [VOUS]
- Supabase → **New project**, **Region = UE** (Paris/Frankfurt), noter le mot de passe DB.
- **Project Settings → API** : récupérer **Project URL**, **anon key** (publique) et
  **service_role key** (secrète — pour Vercel uniquement, jamais dans le front).

### A.2 Authentification  [VOUS]
- **Authentication → Providers → Email** : activé.
- **Allow new users to sign up : OFF** (comptes sur invitation) — ou domaine autorisé.
- **URL Configuration → Site URL** : l'URL Vercel (ex. `https://hexa.vercel.app`).

### A.3 Schéma + sécurité — coller ce SQL  [VOUS] (SQL [MOI])
Supabase → **SQL Editor → New query** → coller → **Run** :

```sql
-- Profils (créés à l'inscription via un trigger)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  stripe_customer_id text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "profiles_self" on public.profiles for select using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles(id, email) values (new.id, new.email)
  on conflict (id) do nothing; return new; end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Grand livre des crédits-dossiers (append-only = auditable)
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  delta int not null,               -- +N à l'achat, -1 à la création d'un dossier
  reason text not null,             -- 'achat' | 'creation_dossier' | 'remboursement'
  ref text,                          -- id session Stripe ou id étude
  created_at timestamptz default now()
);
alter table public.credit_ledger enable row level security;
create policy "ledger_select_own" on public.credit_ledger for select using (owner = auth.uid());
-- (aucune policy insert : écrit seulement par le webhook (service_role) et la RPC ci-dessous)

create or replace function public.credit_balance(uid uuid)
returns int language sql stable as $$
  select coalesce(sum(delta),0)::int from public.credit_ledger where owner = uid; $$;

-- Études (dossiers)
create table public.etudes (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client text, titre text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index etudes_owner_idx on public.etudes(owner, updated_at desc);
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger etudes_touch before update on public.etudes
  for each row execute procedure public.touch_updated_at();

alter table public.etudes enable row level security;
create policy "etudes_select_own" on public.etudes for select using (owner = auth.uid());
create policy "etudes_update_own" on public.etudes for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy "etudes_delete_own" on public.etudes for delete using (owner = auth.uid());
-- PAS de policy insert directe : la création passe par create_etude (consomme 1 crédit)

-- Création d'un dossier = consommation atomique d'1 crédit
create or replace function public.create_etude(p_client text, p_titre text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_bal int;
begin
  if auth.uid() is null then raise exception 'non authentifié'; end if;
  select public.credit_balance(auth.uid()) into v_bal;
  if v_bal < 1 then raise exception 'CREDIT_INSUFFISANT'; end if;
  insert into public.etudes(owner, client, titre, data)
    values (auth.uid(), p_client, p_titre, coalesce(p_data,'{}'::jsonb)) returning id into v_id;
  insert into public.credit_ledger(owner, delta, reason, ref)
    values (auth.uid(), -1, 'creation_dossier', v_id::text);
  return v_id;
end; $$;
```

---

## Phase B — Stripe (paiement)

### B.1 Produit & tarif  [VOUS]
- Stripe → **Products → Add product** : « Crédit dossier — audit patrimonial ».
- **Price** : **50,00 €**, devise EUR, *One-off*. Comportement TVA : **HT** (`tax_behavior =
  exclusive`). Noter le **Price ID** (`price_...`).
- **Stripe Tax** : activer si vous facturez la TVA automatiquement (recommandé, cf. § Légal).

### B.2 Clés & webhook  [VOUS]
- **Developers → API keys** : noter **Secret key** (`sk_...`) et **Publishable key** (`pk_...`).
- **Developers → Webhooks → Add endpoint** : URL `https://VOTRE-APP.vercel.app/api/stripe-webhook`,
  événement **`checkout.session.completed`**. Noter le **Signing secret** (`whsec_...`).
- Travailler d'abord en **mode Test** (cartes de test) avant de passer en Live.

### B.3 Fonctions serveur  [MOI]
- `api/checkout` — vérifie la session Supabase, crée une **Checkout Session** (Price × quantité,
  `metadata.user_id`, URLs succès/annulation), renvoie l'URL de paiement.
- `api/stripe-webhook` — vérifie la signature ; sur `checkout.session.completed`, **crédite**
  le compte (insert `credit_ledger` +quantité via `service_role`) et journalise le paiement.

---

## Phase C — Vercel (hébergement + API)

### C.1 Déploiement  [VOUS]
- Vercel → **Add New → Project** → importer le dépôt GitHub `hexa_dashboard_v5_final`.
- **Root Directory = `docs`** ; framework « Other » (site statique) ; les fonctions sont dans `docs/api` (ou `/api`).
- Déployer → URL type `https://hexa.vercel.app`.

### C.2 Variables d'environnement (Vercel → Settings → Environment Variables)  [VOUS]
| Nom | Valeur | Portée |
|---|---|---|
| `SUPABASE_URL` | Project URL | serveur |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (secret) | serveur seulement |
| `STRIPE_SECRET_KEY` | `sk_...` | serveur seulement |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | serveur seulement |
| `STRIPE_PRICE_ID` | `price_...` | serveur |

Le **front** n'utilise que des valeurs publiques : `SUPABASE_URL`, `anon key`, Stripe
`publishable key` — placées dans `docs/js/hexa-config.js`.

---

## Phase D — Front-end (ce que je code)  [MOI]
1. `hexa-config.js` : URL Supabase + clés publiques (vide par défaut → mode local conservé).
2. Chargement du SDK Supabase (CDN) dans `index.html`.
3. `hexa-store.js` : couche de données (Supabase si configuré, sinon `localStorage`).
4. **Page de connexion** (Supabase Auth : email + mot de passe, mot de passe oublié).
5. **Tableau de bord dossiers** : liste des études, **solde de crédits**, bouton
   **« Acheter un crédit (50 € HT) »** (→ `api/checkout` → Stripe), *nouveau / ouvrir /
   enregistrer / dupliquer / supprimer*.
6. Création d'un dossier via la RPC `create_etude` (débite 1 crédit) ; message clair si
   crédit insuffisant → propose l'achat.
7. Génération PPTX / livret : **inchangée** (illimitée, côté navigateur).

Livré **par phases vérifiables**, sans casser la version locale actuelle.

---

## Légal & conformité (à cadrer — important pour un produit payant)
- **RGPD** : vous êtes **responsable de traitement**. Hébergement **UE** (Supabase),
  **DPA** à signer avec Supabase, Vercel et Stripe ; information des clients finaux ;
  durée de conservation ; registre ; éventuelle **AIPD** (données patrimoniales sensibles).
- **TVA / facturation** : « 50 € HT » ⇒ TVA à collecter. **Stripe Tax** + factures ;
  immatriculation TVA ; comptabilité de la vente en ligne.
- **CGV / CGU / Mentions légales** : obligatoires pour vendre en ligne.
- **Sécurité** : 2FA sur Supabase/Vercel/Stripe/GitHub ; secrets uniquement en variables
  d'environnement ; jamais la `service_role` ni `sk_...` dans le navigateur.

## Ordre & effort
1. **A** (Supabase) — [VOUS] ~1 h. 2. **B** (Stripe test) — [VOUS] ~45 min.
3. **D** (front-end) — [MOI], par phases. 4. **C** (Vercel + env + webhook) — [VOUS] ~45 min.
5. Recette en mode **Test Stripe**, puis passage **Live**.
Total développement [MOI] : ~1 semaine, livré et vérifié par phases.
