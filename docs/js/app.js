/* =============================================================================
 * app.js — Glue applicative
 * -----------------------------------------------------------------------------
 * État, rendu du formulaire, génération/téléchargement du .pptx, import/export
 * des données client (JSON), sauvegarde automatique (localStorage) et aperçu du
 * plan du document.
 * ========================================================================== */
(function () {
  "use strict";

  var LS_KEY = "hexa_etude_data_v12";
  var BUILD = "2026-06-13 · kapaudit";
  var state = { data: null };
  var subscribers = [];        // couche SaaS : notifiée après chaque modification
  var faviconEl = null;
  // Favicon Kapaudit (marque de la PLATEFORME). Distinct des documents générés,
  // qui restent en marque blanche (logo + mentions du cabinet).
  var KAPAUDIT_FAVICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTMiIGZpbGw9IiMwMDUxNTkiLz48dGV4dCB4PSIzMiIgeT0iNDYiIGZvbnQtZmFtaWx5PSJNb250c2VycmF0LEFyaWFsLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNDIiIGZvbnQtd2VpZ2h0PSI4MDAiIGZpbGw9IiNENEFGMzciIHRleHQtYW5jaG9yPSJtaWRkbGUiPks8L3RleHQ+PC9zdmc+";

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function $(id) { return document.getElementById(id); }

  // Favicon de la plateforme Kapaudit (posé une fois au chargement).
  function applyBranding() {
    if (!faviconEl) { faviconEl = document.createElement("link"); faviconEl.rel = "icon"; faviconEl.type = "image/svg+xml"; document.head.appendChild(faviconEl); }
    faviconEl.href = KAPAUDIT_FAVICON;
  }

  function defaultData() {
    var d = clone(window.HEXA_DEFAULT);
    d.modules = {};
    window.HEXA_MODULES.forEach(function (m) { d.modules[m.id] = m.def; });
    return d;
  }

  // Mode cloud (Supabase) actif ? En mode cloud, Supabase est la SEULE source des
  // données client : rien n'est persisté dans le navigateur (localStorage).
  function cloudMode() { return !!(window.HexaCloud && window.HexaCloud.enabled); }

  // Vide récursivement les valeurs en conservant la STRUCTURE : listes → [],
  // scalaires → "". Base d'un dossier vierge à partir du gabarit d'exemple.
  function blankValues(v) {
    if (Array.isArray(v)) return [];
    if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = blankValues(v[k]); }); return o; }
    return "";
  }
  // Clés conservées telles quelles dans un dossier vierge : réglages neutres et
  // textes standards (l'avertissement légal de « contexte » n'est PAS une saisie client).
  var EMPTY_KEEP = { contexte: 1, profilPatrimonial: 1, pvParams: 1 };

  // Dossier vierge : même structure que l'exemple mais toutes les données CLIENT
  // vidées (0 ligne). On conserve l'identité cabinet (doc.advisor*, copyright,
  // titre) et les textes standards ; on vide le nom du client et la date.
  function emptyData() {
    var src = window.HEXA_DEFAULT, d = {};
    Object.keys(src).forEach(function (k) {
      if (k === "doc") { d.doc = clone(src.doc); d.doc.client = ""; d.doc.date = ""; }
      else if (EMPTY_KEEP[k]) { d[k] = clone(src[k]); }
      else { d[k] = blankValues(src[k]); }
    });
    d.modules = {};
    window.HEXA_MODULES.forEach(function (m) { d.modules[m.id] = m.def; });
    return d;
  }

  // ------- aperçu du plan (doit refléter l'ordre de hexa-slides.js) -------
  var OUTLINE = [
    { t: "Couverture" }, { t: "Votre conseiller" },
    { t: "Méthodologie & périmètre", m: "methodologie" }, { t: "Contexte & avertissement", m: "contexte" },
    { t: "Synthèse exécutive" },
    { t: "▸ Section 1 — Découverte", d: 1 }, { t: "Composition du foyer" }, { t: "Composition du patrimoine" }, { t: "Patrimoine immobilier" }, { t: "Analyse budgétaire" },
    { t: "▸ Section 2 — Diagnostic", d: 1 }, { t: "Diagnostic patrimonial" }, { t: "Cartographie des risques" },
    { t: "▸ Section 2.1 — Audit successoral", d: 1 }, { t: "Abattements de donation", m: "successoral" }, { t: "Réserve & quotité disponible" }, { t: "1er décès — Monsieur" }, { t: "1er décès — Madame" }, { t: "Donations & capacité en franchise", cond: function (d) { var enf = ((d.foyer && d.foyer.membres) || []).some(function (mb) { return mb.qualite === "Enfant"; }); return ((d.donations) || []).length > 0 || enf; } },
    { t: "Démembrement en 3 étapes", m: "successoral" }, { t: "Barème usufruit / NP", m: "successoral" },
    { t: "▸ Section 3 — Objectifs", d: 1 }, { t: "Objectifs hiérarchisés" },
    { t: "▸ Section 4 — Préconisations", d: 1, sec: "preco" }, { t: "Arbitrage — Immobilier", sec: "arbitrage" }, { t: "Arbitrage — Patrimoine mobilier", sec: "arbitrage" }, { t: "Suivi des plafonds & marges", sec: "arbitrage" }, { t: "Préconisations personnalisées", sec: "arbitrage" }, { t: "Stratégie de donation", sec: "donationsEnvisagees" }, { t: "Réinvestissement du capital", sec: "reinvestissements" }, { t: "Scénarios de réemploi comparés", sec: "reinvestissements", cond: function (d) { try { return (window.HexaCompute.scenariosAllocation(d) || []).length > 0; } catch (e) { return false; } } },
    { t: "PER — l'essentiel", m: "per" },
    { t: "AV française — l'essentiel", m: "assuranceVie" },
    { t: "AV luxembourgeoise — l'essentiel", m: "assuranceVieLux" },
    { t: "SCPI", m: "scpi" },
    { t: "PEA — l'essentiel", m: "pea" },
    { t: "PEA-PME — l'essentiel", m: "peapme" },
    { t: "FCPR — l'essentiel", m: "fcpr" },
    { t: "SCI à l'IS — l'essentiel", m: "sciIs" },
    { t: "▸ Section 5 — Plan d'action", d: 1, sec: "planAction" }, { t: "Plan d'action", sec: "planAction" },
    { t: "Suivi & prochaines étapes", m: "suivi" },
    { t: "Merci" }
  ];

  function updateOutline() {
    var mods = state.data.modules || {};
    var host = $("outline");
    host.innerHTML = "";
    var n = 0;
    OUTLINE.forEach(function (o) {
      if (o.m && mods[o.m] === false) return;
      if (o.sec && window.HEXA) { var vis = o.sec === "preco" ? window.HEXA.showsPreco() : window.HEXA.shows(o.sec); if (!vis) return; }
      if (o.cond && !o.cond(state.data)) return;
      n++;
      var row = el("div", "outline-row" + (o.d ? " outline-divider" : ""));
      row.appendChild(el("span", "outline-num", String(n)));
      row.appendChild(el("span", "outline-title", o.t));
      host.appendChild(row);
    });
    $("slideCount").textContent = n;
  }

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // ------- persistance -------
  function save() {
    if (cloudMode()) return;   // cloud : Supabase = seule source ; hexa-saas gère l'enregistrement
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.data)); } catch (e) {}
  }
  function onChange() {
    window.HexaCompute.syncDerived(state.data);
    save(); updateOutline();
    // Si le profil patrimonial a re-rempli les objectifs, redessiner le formulaire.
    if (state.data._objectifsRepopulated) { state.data._objectifsRepopulated = false; rebuild(); }
    else { window.HexaForm.refreshComputed(state.data); }
    flagDirty();
    for (var i = 0; i < subscribers.length; i++) { try { subscribers[i](state.data); } catch (e) {} }
  }
  function flagDirty() {
    if (cloudMode()) return;   // cloud : indicateur piloté par hexa-saas (« Enregistré dans le cloud ✓ »)
    var s = $("saveState"); if (s) { s.textContent = "Enregistré localement ✓"; s.classList.add("saved"); }
  }

  function rebuild() {
    window.HexaForm.build(state.data, $("form"), onChange);
    window.HexaForm.buildModules(state.data.modules, $("modules"), function () { save(); updateOutline(); });
    updateOutline();
  }

  // Signature du foyer — sert à rafraîchir le formulaire quand il change :
  //  - libellés des personnes (colonnes « personne » des revenus/charges) ;
  //  - activité / statut fiscal : garde-fou de saisie — normalizeLegacy (appelée
  //    dans syncDerived à CHAQUE modification) recale le statutFiscal stocké quand
  //    l'activité passe à « Retraité » / « Sans activité » ; inclure ces champs ici
  //    déclenche le re-rendu qui affiche la valeur recalée dans le sélecteur.
  function personsKey() {
    try {
      var labels = (window.HexaCompute.personLabels(state.data) || []).join("|");
      var statuts = ((state.data.foyer && state.data.foyer.membres) || []).map(function (m) { return (m.activitePro || "") + "~" + (m.statutFiscal || ""); }).join("|");
      return labels + "§" + statuts;
    } catch (e) { return ""; }
  }
  var lastPersonsKey = "";
  // Reconstruit le formulaire (en préservant les sections ouvertes et le défilement)
  // si la liste des personnes a changé — déclenché à la sortie d'un champ du foyer.
  function rebuildIfPersonsChanged() {
    var k = personsKey();
    if (k === lastPersonsKey) return;
    lastPersonsKey = k;
    var secs = document.querySelectorAll("details.section"), openIdx = [];
    secs.forEach(function (d, i) { if (d.open) openIdx.push(i); });
    var sy = window.scrollY;
    rebuild();
    var ns = document.querySelectorAll("details.section");
    openIdx.forEach(function (i) { if (ns[i]) ns[i].open = true; });
    window.scrollTo(0, sy);
  }

  // ------- génération du .pptx -------
  function sanitize(s) { return String(s || "document").replace(/[^\wÀ-ſ]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60); }

  function generate() {
    var btn = $("btnGenerate");
    btn.disabled = true;
    var prev = btn.textContent;
    btn.textContent = "Génération en cours…";
    $("genMsg").textContent = "";
    // laisse l'UI se rafraîchir avant le calcul
    setTimeout(function () {
      try {
        var pptx = window.HexaDeck.generate(state.data);
        var fname = "Etude_patrimoniale_" + sanitize(state.data.doc.client) + "_" + sanitize(state.data.doc.date) + ".pptx";
        pptx.writeFile({ fileName: fname }).then(function () {
          $("genMsg").innerHTML = '<span class="ok">✓ Présentation générée : <strong>' + fname + "</strong></span>";
          try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: "pptx-genere", title: "PowerPoint genere", event: true }); } catch (e) {}
        }).catch(function (e) {
          $("genMsg").innerHTML = '<span class="err">Erreur lors de l\'écriture : ' + (e && e.message || e) + "</span>";
        }).finally(function () { btn.disabled = false; btn.textContent = prev; });
      } catch (e) {
        $("genMsg").innerHTML = '<span class="err">Erreur de génération : ' + (e && e.message || e) + "</span>";
        console.error(e);
        btn.disabled = false; btn.textContent = prev;
      }
    }, 30);
  }

  // ------- livret imprimable A4 (HTML -> window.print) -------
  function openPrintBooklet() {
    window.HexaCompute.syncDerived(state.data); // valeurs dérivées fraîches avant rendu
    window.HexaPrint.open(state.data);
  }

  // ------- import / export JSON -------
  function exportJSON() {
    window.HexaCompute.syncDerived(state.data);
    var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "donnees_" + sanitize(state.data.doc.client) + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        if (!obj.doc) throw new Error("Fichier de données invalide (clé 'doc' manquante).");
        if (!obj.modules) { obj.modules = {}; window.HEXA_MODULES.forEach(function (m) { obj.modules[m.id] = m.def; }); }
        state.data = obj; save(); rebuild();
        $("genMsg").innerHTML = '<span class="ok">✓ Données importées.</span>';
      } catch (e) {
        $("genMsg").innerHTML = '<span class="err">Import impossible : ' + (e && e.message || e) + "</span>";
      }
    };
    reader.readAsText(file);
  }

  // Remplace intégralement le dossier courant (vider / charger l'exemple) et
  // propage aux abonnés (enregistrement cloud) — contrairement à setData qui sert
  // à OUVRIR un dossier déjà stocké dans Supabase.
  function applyLoadedData(obj) {
    state.data = obj;
    window.HexaCompute.syncDerived(state.data);
    save(); flagDirty(); rebuild(); lastPersonsKey = personsKey();
    for (var i = 0; i < subscribers.length; i++) { try { subscribers[i](state.data); } catch (e) {} }
  }

  function resetDefaults() {
    if (!confirm("Vider le dossier ? Tous les champs seront réinitialisés à vide.")) return;
    applyLoadedData(emptyData());
    $("genMsg").textContent = "";
  }

  // « Charger l'exemple » : remplit le dossier courant avec le jeu de démonstration
  // (« Monsieur et Madame X »). La démo ne s'affiche plus automatiquement.
  function loadExample() {
    if (!confirm("Charger l'exemple « Monsieur et Madame X » ? Le contenu actuel du dossier sera remplacé.")) return;
    applyLoadedData(defaultData());
    $("genMsg").textContent = "";
  }

  // ------- init -------
  function init() {
    // Indicateur de version visible (confirme qu'on exécute bien la dernière build).
    var verEl = document.querySelector(".appbar-titles p");
    if (verEl) verEl.insertAdjacentHTML("beforeend", ' <span style="opacity:.55;font-size:11px;font-weight:600">— build ' + BUILD + "</span>");
    var saved = null;
    // Cloud : aucune donnée client en local (on purge un éventuel ancien cache) ;
    // le dossier réel est chargé depuis Supabase après connexion. Sinon (autonome) :
    // reprise du cache local. Dans les deux cas, démarrage à VIDE (plus de démo auto).
    if (cloudMode()) { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
    else { try { saved = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {} }
    state.data = (saved && saved.doc) ? saved : emptyData();
    if (!state.data.modules) { state.data.modules = {}; window.HEXA_MODULES.forEach(function (m) { state.data.modules[m.id] = m.def; }); }
    window.HexaCompute.syncDerived(state.data);
    applyBranding();

    rebuild();
    state.data._objectifsRepopulated = false; // déjà rendu par rebuild()
    lastPersonsKey = personsKey();
    // Foyer modifié (nom/qualité d'un membre, ajout/suppression) : à la sortie du
    // champ, on rafraîchit les colonnes « personne » des revenus & charges.
    $("form").addEventListener("change", rebuildIfPersonsChanged);

    $("btnGenerate").addEventListener("click", generate);
    $("btnPrint").addEventListener("click", openPrintBooklet);
    $("btnExport").addEventListener("click", exportJSON);
    $("btnReset").addEventListener("click", resetDefaults);
    $("btnExample").addEventListener("click", loadExample);
    $("fileImport").addEventListener("change", function (e) { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; });
    $("btnImport").addEventListener("click", function () { $("fileImport").click(); });

    // ouvrir/fermer toutes les sections
    $("btnExpand").addEventListener("click", function () {
      var open = $("btnExpand").dataset.open !== "1";
      document.querySelectorAll("details.section").forEach(function (d) { d.open = open; });
      $("btnExpand").dataset.open = open ? "1" : "0";
      $("btnExpand").textContent = open ? "Tout réduire" : "Tout déplier";
    });
  }

  // ---- API pour la couche SaaS (hexa-saas.js) ----
  // Définie dans tous les cas mais utilisée UNIQUEMENT quand HexaCloud est
  // configuré. En mode local (fichier autonome), personne ne l'appelle : le
  // comportement localStorage reste strictement inchangé.
  window.HexaApp = {
    // Données courantes du formulaire (valeurs dérivées à jour).
    getData: function () { window.HexaCompute.syncDerived(state.data); return state.data; },
    // Charge un dossier dans le formulaire (ouverture d'une étude cloud).
    setData: function (obj) {
      if (!obj || !obj.doc) return;
      if (!obj.modules) { obj.modules = {}; window.HEXA_MODULES.forEach(function (m) { obj.modules[m.id] = m.def; }); }
      state.data = obj; window.HexaCompute.syncDerived(state.data);
      save(); rebuild(); lastPersonsKey = personsKey();
    },
    // Nouveau dossier = modèle VIERGE (l'appelant fixe le nom du client).
    newData: function () { return emptyData(); },
    // S'abonner aux modifications (pour l'enregistrement cloud différé).
    subscribe: function (cb) { if (typeof cb === "function") subscribers.push(cb); },
    // Purge le cache local + recharge le modèle (déconnexion : aucune donnée
    // client ne subsiste dans le navigateur).
    clearLocal: function () { try { localStorage.removeItem(LS_KEY); } catch (e) {} state.data = emptyData(); window.HexaCompute.syncDerived(state.data); rebuild(); lastPersonsKey = personsKey(); }
  };

  document.addEventListener("DOMContentLoaded", init);
})();
