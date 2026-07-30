/* =============================================================================
 * hexa-config.js — Configuration front-end (valeurs PUBLIQUES uniquement)
 * -----------------------------------------------------------------------------
 * Laisser les champs VIDES => l'application fonctionne en mode LOCAL (localStorage),
 * exactement comme aujourd'hui. Renseigner les clés => mode CLOUD (Supabase + Stripe).
 *
 * ⚠️ Ici ne vont QUE des valeurs publiques :
 *   - supabaseAnonKey  : clé « anon » publique (protégée par les règles RLS).
 *   - stripePublishableKey : clé « pk_… » publique.
 * Les clés SECRÈTES (service_role, sk_…, whsec_…) ne vont JAMAIS ici : elles
 * restent dans les variables d'environnement Vercel (voir .env.example).
 * ========================================================================== */
window.HEXA_CONFIG = {
  supabaseUrl: "",            // ex : https://xxxx.supabase.co
  supabaseAnonKey: "",        // clé anon publique
  stripePublishableKey: ""    // pk_test_… puis pk_live_…
};
