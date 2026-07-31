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
  supabaseUrl: "https://eyxfasxstljrsixbdxug.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5eGZhc3hzdGxqcnNpeGJkeHVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NDQ1ODYsImV4cCI6MjEwMTAyMDU4Nn0.oHno7zFF1HNDyItBqBOPSuhPSm3_Le8mxnvFZqfrfzk",
  stripePublishableKey: ""    // pk_test_… puis pk_live_… (à renseigner pour l'achat de crédits)
};
