// =============================================================================
// api/checkout.js — Vercel serverless function (Node, CommonJS)
// Crée une session de paiement Stripe Checkout pour acheter des crédits-dossiers.
// Le client (navigateur) appelle POST /api/checkout avec :
//   - en-tête  Authorization: Bearer <access_token Supabase>
//   - corps    { "quantity": 1 }
// Renvoie { url } → on redirige l'utilisateur vers cette URL Stripe.
//
// Variables d'environnement (Vercel → Settings → Environment Variables) :
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL
// =============================================================================
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Méthode non autorisée" }); return; }
  try {
    // 1) Authentifier l'utilisateur via son jeton Supabase
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) { res.status(401).json({ error: "Non authentifié" }); return; }
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData || !userData.user) { res.status(401).json({ error: "Session invalide" }); return; }
    const user = userData.user;

    // 2) Quantité de crédits à acheter (1 par défaut, borné)
    let quantity = parseInt((req.body && req.body.quantity) || 1, 10);
    if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
    if (quantity > 100) quantity = 100;

    const appUrl = process.env.APP_URL || ("https://" + (req.headers.host || ""));

    // 3) Créer la session Checkout (paiement unique)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: quantity }],
      customer_email: user.email || undefined,
      client_reference_id: user.id,
      metadata: { user_id: user.id, credits: String(quantity) },
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },              // TVA via Stripe Tax (à activer côté Stripe)
      success_url: appUrl + "?paiement=succes",
      cancel_url: appUrl + "?paiement=annule"
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "Erreur lors de la création du paiement" });
  }
};
