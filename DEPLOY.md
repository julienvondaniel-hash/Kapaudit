# Kapaudit — Déploiement (Supabase + Vercel + Stripe)

Ce dépôt contient tout le nécessaire pour la version SaaS. **Ce qui est fourni ici**
(infrastructure + backend) est complet ; **le câblage de la page de connexion et du
tableau de bord des dossiers dans l'app (Phase D)** est l'étape suivante.

## Fichiers du dépôt (à pousser sur GitHub)

| Fichier | Rôle | Où |
|---|---|---|
| `supabase/schema.sql` | Schéma base + RLS + fonctions (crédits, création dossier) | Supabase → SQL Editor |
| `api/checkout.js` | Fonction Vercel : crée la session de paiement Stripe | Vercel (serverless) |
| `api/stripe-webhook.js` | Fonction Vercel : crédite le compte après paiement | Vercel (serverless) |
| `vercel.json` | Config Vercel (site = `docs/`, fonctions = `api/`) | racine |
| `package.json` | Dépendances des fonctions (`stripe`, `@supabase/supabase-js`) | racine |
| `.env.example` | Modèle des variables d'environnement (valeurs → Vercel) | racine |
| `docs/js/hexa-config.js` | Config front PUBLIQUE (URL + clés publiques) | front |
| `docs/js/hexa-cloud.js` | Couche cloud (auth, dossiers, crédits, paiement) — inerte tant que non configurée | front |
| `docs/js/hexa-saas.js` | Interface SaaS : écran de connexion + tableau de bord des dossiers + crédits | front |

> Les clés **secrètes** (`service_role`, `sk_…`, `whsec_…`) ne figurent **jamais** dans le
> dépôt : elles se saisissent dans **Vercel → Environment Variables** (cf. `.env.example`).

## Étapes

### 1. Supabase
1. Créer le projet (**région UE**).
2. **SQL Editor** → coller `supabase/schema.sql` → **Run**.
3. **Authentication → Email** activé ; **inscription libre = OFF** ; **Site URL** = l'URL Vercel.
4. Noter : *Project URL*, *anon key* (publique), *service_role key* (secrète).

### 2. Stripe (mode Test d'abord)
1. **Products** → « Crédit dossier » → **Price 50,00 € EUR** (one-off, HT) → noter le **Price ID**.
2. **API keys** → noter *Secret key* (`sk_…`) et *Publishable key* (`pk_…`).
3. **Webhooks** → endpoint `https://<app>.vercel.app/api/stripe-webhook`, événement
   `checkout.session.completed` → noter le *Signing secret* (`whsec_…`).
4. (Recommandé) activer **Stripe Tax** pour la TVA.

### 3. Vercel
1. **Add New → Project** → importer le dépôt GitHub. **Root Directory = racine du dépôt**
   (le site est servi depuis `docs/` via `vercel.json`, les fonctions depuis `api/`).
2. **Settings → Environment Variables** (voir `.env.example`) :
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_ID`, `APP_URL`.
3. **Deploy**.

### 4. Front-end
Éditer `docs/js/hexa-config.js` avec les **valeurs publiques** :
```js
window.HEXA_CONFIG = {
  supabaseUrl: "https://VOTRE-PROJET.supabase.co",
  supabaseAnonKey: "eyJhbGci...",       // clé anon publique
  stripePublishableKey: "pk_test_..."
};
```
(Laisser vide = l'app reste en mode local, comme aujourd'hui.)

### 5. Recette (Test)
- Créer un utilisateur (Authentication → Users → Invite), lui offrir des crédits de test :
  `insert into public.credit_ledger(owner, delta, reason) values ('<uuid>', 3, 'offert');`
- Acheter un crédit avec une **carte de test Stripe** → vérifier que le webhook ajoute le crédit.
- Créer un dossier → le solde diminue de 1 ; générer PPTX/livret (illimité).

## Phase D — interface SaaS (faite)
Câblée dans l'application (`docs/index.html` charge `hexa-config.js` + `hexa-cloud.js` +
`hexa-saas.js` après `app.js`) :
- **écran de connexion** (Supabase Auth, comptes sur invitation) ;
- **tableau de bord « Mes dossiers »** : lister / ouvrir / nouveau / supprimer, avec
  **enregistrement cloud automatique** (différé) du dossier ouvert ;
- **bandeau essai gratuit + solde de crédits** et bouton **« Acheter (50 € HT) »**.

Le mode cloud ne s'active que si `hexa-config.js` est renseigné ; sinon l'app reste en mode
local (localStorage). Le **fichier autonome** reste 100 % local — les scripts cloud en sont
retirés par `build_standalone.py`.

Reste à finaliser pour la mise en production :
1. **Stripe** : renseigner `stripePublishableKey` (`pk_…`) dans `hexa-config.js` et le
   `STRIPE_PRICE_ID` côté Vercel pour activer le bouton d'achat (inutile pendant l'essai 30 j).
2. **Recette navigateur** : inviter un utilisateur (Authentication → Users → Invite), se
   connecter, créer / ouvrir un dossier, générer PPTX + livret, tester l'achat (carte de test).

## Rappel conformité
Hébergement UE, RGPD (responsable de traitement, information des clients, DPA Supabase/Vercel/
Stripe), TVA/facturation (« 50 € HT »), CGV/CGU/mentions légales, 2FA sur tous les comptes.
