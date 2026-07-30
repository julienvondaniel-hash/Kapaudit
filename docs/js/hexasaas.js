/* =============================================================================
 * hexa-saas.js — Interface SaaS Kapaudit (connexion + tableau de bord dossiers)
 * -----------------------------------------------------------------------------
 * Chargé APRÈS app.js et hexa-cloud.js. INERTE si le cloud n'est pas configuré
 * (HexaCloud.enabled === false) : le mode local (localStorage) reste inchangé.
 * Retiré du fichier autonome par build_standalone.py.
 *
 * Rôle :
 *   - porte de connexion (Supabase Auth, comptes sur invitation) ;
 *   - tableau de bord « Mes dossiers » : lister / ouvrir / créer / supprimer ;
 *   - bandeau essai gratuit + solde de crédits + achat (Stripe) ;
 *   - enregistrement cloud différé (debounce) du dossier ouvert.
 * Il pilote le formulaire via l'API window.HexaApp exposée par app.js.
 * ========================================================================== */
(function () {
  "use strict";

  var Cloud = window.HexaCloud;
  if (!Cloud || !Cloud.enabled) return;          // mode local : ne rien faire
  var App = window.HexaApp || null;

  var currentId = null;      // id du dossier cloud ouvert (null = aucun)
  var access = null;         // { trial_ends_at, trial_active, credits }
  var lastUid = undefined;   // déduplique les événements d'authentification
  var saveTimer = null;

  // ---------------------------------------------------------------- helpers --
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function brandRow(word) {
    return h("div", { class: "saas-brand" }, [
      h("span", { class: "saas-mark", text: "K" }),
      h("span", { class: "saas-word", text: word })
    ]);
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }); }
    catch (e) { return String(iso).slice(0, 10); }
  }
  function fmtDateTime(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return fmtDate(iso); }
  }
  function friendly(e) {
    var m = (e && e.message) || String(e || "");
    if (/Invalid login credentials/i.test(m)) return "e-mail ou mot de passe incorrect.";
    if (/Email not confirmed/i.test(m)) return "e-mail non confirmé.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "connexion au serveur impossible.";
    return m;
  }

  // ------------------------------------------------------------- éléments UI --
  var gate, gateEmail, gatePwd, gateMsg;
  var dash, dashList, banner;
  var bar, barEmail;

  function buildGate() {
    gateEmail = h("input", { type: "email", class: "saas-input", placeholder: "adresse e-mail", autocomplete: "username" });
    gatePwd = h("input", { type: "password", class: "saas-input", placeholder: "mot de passe", autocomplete: "current-password" });
    gateMsg = h("div", { class: "saas-msg" });
    var card = h("form", { class: "saas-card", onsubmit: function (ev) { ev.preventDefault(); doSignIn(); } }, [
      brandRow("Kapaudit"),
      h("p", { class: "saas-sub", text: "Espace conseiller — accès sur invitation." }),
      gateEmail, gatePwd,
      h("button", { type: "submit", class: "saas-btn saas-btn-primary saas-btn-block", text: "Se connecter" }),
      h("button", { type: "button", class: "saas-link", text: "Mot de passe oublié ?", onclick: doReset }),
      gateMsg
    ]);
    gate = h("div", { class: "saas-overlay", id: "saasGate" }, [card]);
    document.body.appendChild(gate);
  }

  function buildDash() {
    dashList = h("div", { class: "saas-list" });
    banner = h("div", { class: "saas-banner" });
    var head = h("div", { class: "saas-dash-head" }, [
      brandRow("Mes dossiers"),
      h("div", { class: "saas-spacer" }),
      h("button", { class: "saas-btn", text: "Se déconnecter", onclick: doSignOut }),
      h("button", { class: "saas-btn", id: "saasClose", text: "Retour au dossier", onclick: hideOverlays }),
      h("button", { class: "saas-btn saas-btn-primary", text: "+ Nouveau dossier", onclick: doNew })
    ]);
    var card = h("div", { class: "saas-card saas-card-wide" }, [head, banner, dashList]);
    dash = h("div", { class: "saas-overlay", id: "saasDash" }, [card]);
    document.body.appendChild(dash);
  }

  function buildBar() {
    barEmail = h("span", { class: "saas-bar-email" });
    bar = h("div", { class: "saas-bar" }, [
      h("button", { class: "saas-btn saas-btn-light", text: "☰ Mes dossiers", onclick: openDash }),
      barEmail,
      h("button", { class: "saas-btn saas-btn-light", text: "Déconnexion", onclick: doSignOut })
    ]);
    bar.style.display = "none";
    var inner = document.querySelector(".appbar-inner");
    if (inner) inner.appendChild(bar);
  }

  // ------------------------------------------------------------ affichage ----
  function showGate() { if (gate) gate.style.display = "flex"; if (dash) dash.style.display = "none"; if (bar) bar.style.display = "none"; }
  function hideOverlays() { if (gate) gate.style.display = "none"; if (dash) dash.style.display = "none"; }
  function openDash() { if (dash) { dash.style.display = "flex"; } updateCloseBtn(); refreshDash(); }
  function updateCloseBtn() { var c = $("saasClose"); if (c) c.style.display = currentId ? "" : "none"; }

  function setSaveState(txt, ok) {
    var s = $("saveState"); if (!s) return;
    s.textContent = txt;
    s.className = "save-state" + (ok ? " saved" : "");
  }

  // ------------------------------------------------------------ tableau ------
  function refreshDash() {
    dashList.innerHTML = "";
    dashList.appendChild(h("div", { class: "saas-muted", text: "Chargement…" }));
    Promise.all([
      Cloud.accessStatus().catch(function () { return null; }),
      Cloud.listEtudes()
    ]).then(function (res) {
      access = res[0]; renderBanner();
      renderList(res[1] || []);
    }).catch(function (e) {
      dashList.innerHTML = "";
      dashList.appendChild(h("div", { class: "saas-err", text: "Impossible de charger vos dossiers : " + friendly(e) }));
    });
  }

  function renderBanner() {
    banner.innerHTML = "";
    var credits = access && typeof access.credits === "number" ? access.credits : 0;
    var trialActive = !!(access && access.trial_active);
    var msg;
    if (trialActive) {
      msg = h("span", {}, ["Essai gratuit actif jusqu'au ", h("strong", { text: fmtDate(access.trial_ends_at) }), " — création de dossiers illimitée."]);
    } else {
      msg = h("span", {}, ["Essai terminé. Crédits disponibles : ", h("strong", { text: String(credits) }), " (1 crédit = 1 dossier)."]);
    }
    banner.appendChild(h("div", { class: "saas-banner-msg" }, [msg]));
    banner.appendChild(h("button", { class: "saas-btn saas-btn-gold", text: "Acheter un crédit (50 € HT)", onclick: doBuy }));
  }

  function renderList(rows) {
    dashList.innerHTML = "";
    if (!rows.length) {
      dashList.appendChild(h("div", { class: "saas-muted", text: "Aucun dossier pour le moment — créez votre premier dossier." }));
      return;
    }
    rows.forEach(function (r) {
      var sub = (r.titre && r.client ? r.titre + " · " : "") + "Modifié le " + fmtDateTime(r.updated_at);
      dashList.appendChild(h("div", { class: "saas-row" }, [
        h("div", { class: "saas-row-main" }, [
          h("div", { class: "saas-row-title", text: r.client || r.titre || "Dossier sans nom" }),
          h("div", { class: "saas-row-sub", text: sub })
        ]),
        h("button", { class: "saas-btn saas-btn-primary", text: "Ouvrir", onclick: function () { doOpen(r.id); } }),
        h("button", { class: "saas-btn saas-btn-ghost", text: "Supprimer", onclick: function () { doDelete(r.id, r.client || r.titre); } })
      ]));
    });
  }

  // ------------------------------------------------------------ actions ------
  function doSignIn() {
    gateMsg.textContent = "Connexion…"; gateMsg.className = "saas-msg";
    Cloud.signIn(gateEmail.value.trim(), gatePwd.value).then(function () {
      gatePwd.value = "";                 // onAuth prend le relais
    }).catch(function (e) {
      gateMsg.textContent = "Échec : " + friendly(e); gateMsg.className = "saas-msg saas-err";
    });
  }

  function doReset() {
    var em = gateEmail.value.trim();
    if (!em) { gateMsg.textContent = "Saisissez d'abord votre e-mail."; gateMsg.className = "saas-msg saas-err"; return; }
    Cloud.ready().then(function (c) { return c.auth.resetPasswordForEmail(em); })
      .then(function () { gateMsg.textContent = "Si un compte existe, un e-mail de réinitialisation vient d'être envoyé."; gateMsg.className = "saas-msg saas-ok"; })
      .catch(function (e) { gateMsg.textContent = friendly(e); gateMsg.className = "saas-msg saas-err"; });
  }

  function doSignOut() {
    Cloud.signOut().finally(function () {
      currentId = null;
      if (App && App.clearLocal) App.clearLocal();   // efface le cache local
      // onAuth(null) réaffiche la porte de connexion
    });
  }

  function doOpen(id) {
    Cloud.getEtude(id).then(function (data) {
      if (!data || !data.doc) { alert("Ce dossier est vide ou illisible."); return; }
      currentId = id;
      if (App && App.setData) App.setData(data);
      hideOverlays(); updateCloseBtn();
      setSaveState("Dossier ouvert (cloud) ✓", true);
    }).catch(function (e) { alert("Ouverture impossible : " + friendly(e)); });
  }

  function doNew() {
    var name = prompt("Nom du client pour ce nouveau dossier :", "");
    if (name === null) return;             // annulé
    var data = (App && App.newData) ? App.newData() : { doc: {} };
    data.doc = data.doc || {};
    if (name.trim()) data.doc.client = name.trim();
    Cloud.createEtude(data).then(function (id) {
      currentId = id;
      if (App && App.setData) App.setData(data);
      hideOverlays(); updateCloseBtn();
      setSaveState("Nouveau dossier créé (cloud) ✓", true);
    }).catch(function (e) {
      if (String(e && e.message) === "ACCES_REQUIS") {
        if (confirm("Votre essai gratuit est terminé et vous n'avez plus de crédit.\n\nAcheter un crédit (50 € HT) pour créer ce dossier ?")) doBuy();
      } else {
        alert("Création impossible : " + friendly(e));
      }
    });
  }

  function doDelete(id, label) {
    if (!confirm("Supprimer définitivement le dossier « " + (label || "") + " » ?\nCette action est irréversible.")) return;
    Cloud.removeEtude(id).then(function () {
      if (currentId === id) { currentId = null; if (App && App.clearLocal) App.clearLocal(); }
      refreshDash(); updateCloseBtn();
    }).catch(function (e) { alert("Suppression impossible : " + friendly(e)); });
  }

  function doBuy() {
    Cloud.buyCredits(1).catch(function (e) {
      alert("Le paiement n'est pas encore disponible : " + friendly(e) + "\n\n(À configurer : clé Stripe pk_ dans hexa-config.js + Price ID côté Vercel.)");
    });
  }

  // -------------------------------------------------- enregistrement cloud ---
  function scheduleSave() {
    if (!currentId) return;                // aucun dossier cloud ouvert
    setSaveState("Enregistrement…", false);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 1500);
  }
  function flush() {
    if (!currentId || !App) return;
    var data = App.getData();
    Cloud.saveEtude(currentId, data)
      .then(function () { setSaveState("Enregistré dans le cloud ✓", true); })
      .catch(function () { setSaveState("Échec d'enregistrement cloud — réessai à la prochaine modification", false); });
  }

  // ------------------------------------------------------------ auth flow ----
  function onAuth(user) {
    var uid = user ? user.id : null;
    if (uid === lastUid) return;           // pas de changement réel
    lastUid = uid;
    if (user) {
      barEmail.textContent = user.email || "";
      bar.style.display = "";
      gate.style.display = "none";
      openDash();
    } else {
      currentId = null;
      showGate();
    }
  }

  function updateFooter() {
    var ps = document.querySelectorAll(".appfoot p");
    Array.prototype.forEach.call(ps, function (p) {
      if (/aucun envoi serveur/i.test(p.textContent)) {
        p.innerHTML = p.innerHTML.replace(
          /Données enregistrées localement dans votre navigateur \(aucun envoi serveur\)\./,
          "Dossiers hébergés de façon sécurisée (Supabase, Union européenne).");
      }
    });
  }

  function init() {
    buildBar(); buildGate(); buildDash();
    updateFooter();
    if (App && App.subscribe) App.subscribe(scheduleSave);
    showGate();                            // masque l'app tant que l'auth n'est pas connue
    Cloud.onAuth(onAuth);                  // changements de session (connexion / déconnexion)
    Cloud.currentUser().then(onAuth).catch(function () { onAuth(null); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
