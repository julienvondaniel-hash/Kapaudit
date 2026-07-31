// =============================================================================
// api/stripe-webhook.js — Vercel serverless function (Node, CommonJS)
// Reçoit les événements Stripe. Sur « checkout.session.completed », crédite le
// compte de l'utilisateur (crédits-dossiers) de façon ATOMIQUE et IDEMPOTENTE
// via la fonction Postgres record_purchase (clé service_role).
//
// IMPORTANT : Stripe exige le CORPS BRUT (non parsé) pour vérifier la signature.
// On désactive donc le body parser de Vercel (handler.config) et on lit le flux
// manuellement.
//
// Variables d'environnement :
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Webhook Stripe à configurer : URL = https://<votre-app>.vercel.app/api/stripe-webhook
//   Événement : checkout.session.completed  → copier le « Signing secret » (whsec_...)
// =============================================================================
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on("data", function (c) { chunks.push(typeof c === "string" ? Buffer.from(c) : c); });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end("Méthode non autorisée"); return; }

  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Signature webhook invalide:", e.message);
    res.status(400).end("Signature invalide");
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const userId = (s.metadata && s.metadata.user_id) || s.client_reference_id;
      const credits = parseInt((s.metadata && s.metadata.credits) || "1", 10) || 1;
      if (userId) {
        const { data, error } = await supabaseAdmin.rpc("record_purchase", {
          p_owner: userId,
          p_credits: credits,
          p_session: s.id,
          p_amount: s.amount_total || null,
          p_currency: s.currency || "eur"
        });
        if (error) { console.error("record_purchase error:", error); res.status(500).end("Erreur base"); return; }
        console.log("Crédits ajoutés:", credits, "user:", userId, "nouveau:", data);
      }
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error("webhook handler error:", e);
    res.status(500).end("Erreur serveur");
  }
}

// Ne PAS parser le corps : Stripe vérifie la signature sur les octets bruts.
// (Attaché au handler APRÈS son affectation, sinon la config serait perdue.)
handler.config = { api: { bodyParser: false } };
module.exports = handler;
