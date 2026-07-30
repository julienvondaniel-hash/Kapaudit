/* =============================================================================
 * hexa-cloud.js — Couche cloud (Supabase Auth + base + Stripe) pour Kapaudit
 * -----------------------------------------------------------------------------
 * Module AUTONOME et INERTE tant que hexa-config.js n'est pas renseigné :
 * `HexaCloud.enabled` vaut false et rien ne change au fonctionnement local.
 * Une fois configuré, il expose l'authentification, la gestion des dossiers
 * (études), le solde de crédits et l'achat de crédits (Stripe Checkout).
 *
 * Câblage dans l'application (page de connexion + tableau de bord des dossiers)
 * = étape suivante (Phase D). Ce fichier fournit l'API ; il ne modifie pas app.js.
 *
 * API :
 *   HexaCloud.enabled            -> booléen (config présente ?)
 *   HexaCloud.ready()            -> Promise (SDK chargé + client prêt)
 *   HexaCloud.signIn(email,pwd)  -> Promise({ user }) | rejette
 *   HexaCloud.signOut()          -> Promise
 *   HexaCloud.currentUser()      -> Promise(user | null)
 *   HexaCloud.onAuth(cb)         -> abonnement aux changements de session
 *   HexaCloud.listEtudes()       -> Promise([{id,client,titre,updated_at}])
 *   HexaCloud.getEtude(id)       -> Promise({...data})
 *   HexaCloud.createEtude(data)  -> Promise(id)   (consomme 1 crédit)
 *   HexaCloud.saveEtude(id,data) -> Promise
 *   HexaCloud.removeEtude(id)    -> Promise
 *   HexaCloud.creditBalance()    -> Promise(int)
 *   HexaCloud.buyCredits(qty)    -> redirige vers Stripe Checkout
 * ========================================================================== */
(function () {
  "use strict";

  var CFG = window.HEXA_CONFIG || {};
  var enabled = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  var sb = null;          // client Supabase
  var readyPromise = null;

  // Charge dynamiquement le SDK Supabase (CDN) puis crée le client.
  function ensureSdk() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise(function (resolve, reject) {
      if (!enabled) { reject(new Error("Cloud non configuré")); return; }
      if (window.supabase && window.supabase.createClient) { init(); return; }
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload = init;
      s.onerror = function () { reject(new Error("Chargement du SDK Supabase impossible")); };
      document.head.appendChild(s);
      function init() {
        sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true }
        });
        resolve(sb);
      }
    });
    return readyPromise;
  }

  function client() { return ensureSdk(); }

  // ---- Authentification ----------------------------------------------------
  function signIn(email, password) {
    return client().then(function (c) {
      return c.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
        if (r.error) throw r.error; return r.data;
      });
    });
  }
  function signOut() { return client().then(function (c) { return c.auth.signOut(); }); }
  function currentUser() {
    return client().then(function (c) { return c.auth.getUser().then(function (r) { return (r.data && r.data.user) || null; }); });
  }
  function onAuth(cb) {
    return client().then(function (c) { return c.auth.onAuthStateChange(function (_e, session) { cb(session ? session.user : null); }); });
  }
  function accessToken() {
    return client().then(function (c) { return c.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session.access_token : null; }); });
  }

  // ---- Dossiers (études) ----------------------------------------------------
  function listEtudes() {
    return client().then(function (c) {
      return c.from("etudes").select("id,client,titre,updated_at").order("updated_at", { ascending: false })
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    });
  }
  function getEtude(id) {
    return client().then(function (c) {
      return c.from("etudes").select("data").eq("id", id).single()
        .then(function (r) { if (r.error) throw r.error; return r.data ? r.data.data : null; });
    });
  }
  // Crée un dossier via la RPC (consomme 1 crédit, atomique). Rejette
  // 'CREDIT_INSUFFISANT' si le solde est nul.
  function createEtude(data) {
    var doc = (data && data.doc) || {};
    return client().then(function (c) {
      return c.rpc("create_etude", { p_client: doc.client || "", p_titre: doc.title || "Étude patrimoniale", p_data: data || {} })
        .then(function (r) {
          if (r.error) { var m = String(r.error.message || ""); throw new Error(/CREDIT_INSUFFISANT/.test(m) ? "CREDIT_INSUFFISANT" : m); }
          return r.data; // uuid du dossier créé
        });
    });
  }
  function saveEtude(id, data) {
    var doc = (data && data.doc) || {};
    return client().then(function (c) {
      return c.from("etudes").update({ client: doc.client || "", titre: doc.title || "", data: data || {} }).eq("id", id)
        .then(function (r) { if (r.error) throw r.error; return true; });
    });
  }
  function removeEtude(id) {
    return client().then(function (c) {
      return c.from("etudes").delete().eq("id", id).then(function (r) { if (r.error) throw r.error; return true; });
    });
  }

  // ---- Crédits & paiement ---------------------------------------------------
  function creditBalance() {
    return currentUser().then(function (u) {
      if (!u) return 0;
      return client().then(function (c) {
        return c.rpc("credit_balance", { uid: u.id }).then(function (r) { if (r.error) throw r.error; return r.data || 0; });
      });
    });
  }
  // Achète `qty` crédits : appelle /api/checkout puis redirige vers Stripe.
  function buyCredits(qty) {
    return accessToken().then(function (tok) {
      if (!tok) throw new Error("Non authentifié");
      return fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify({ quantity: qty || 1 })
      }).then(function (res) { return res.json(); }).then(function (j) {
        if (!j || !j.url) throw new Error((j && j.error) || "Paiement indisponible");
        window.location.href = j.url;
      });
    });
  }

  window.HexaCloud = {
    enabled: enabled,
    ready: ensureSdk,
    signIn: signIn, signOut: signOut, currentUser: currentUser, onAuth: onAuth,
    listEtudes: listEtudes, getEtude: getEtude, createEtude: createEtude,
    saveEtude: saveEtude, removeEtude: removeEtude,
    creditBalance: creditBalance, buyCredits: buyCredits
  };
})();
