/* =============================================================================
 * hexa-brand.js — Charte graphique & helpers de mise en page Hexa Patrimoine
 * -----------------------------------------------------------------------------
 * Constantes de marque (couleurs, polices, géométrie) et fonctions de dessin
 * réutilisables par tous les générateurs de slides (hexa-slides.js).
 * Tout est exposé sous le namespace global `HEXA`.
 * ========================================================================== */
(function () {
  "use strict";

  // --- Palette de marque (extraite du modèle PowerPoint original) ----------
  var COLORS = {
    PETROL:    "005159", // vert pétrole principal
    PETROL_DK: "003B41", // pétrole foncé (dégradés, fonds)
    PETROL_LT: "1B6B7C", // pétrole clair
    TEAL:      "5BA5B8", // turquoise accent
    TEAL_PALE: "D6EDF0", // turquoise très clair (fonds doux)
    GOLD:      "D4AF37", // or (accents premium)
    GOLD_DK:   "B8941F",
    INK:       "1F2937", // texte titre (gris très foncé)
    SLATE:     "334155", // texte courant
    SLATE_LT:  "64748B", // texte secondaire
    LINE:      "E2E8F0", // filets / bordures claires
    MIST:      "F7FAFA", // fond de carte très clair
    CLOUD:     "F1F5F8", // fond alterné
    PAPER:     "FFFFFF",
    GREEN:     "1A7A4A", // positif / force
    GREEN_BG:  "E8F3ED",
    RED:       "C0392B", // alerte / vigilance
    RED_BG:    "FBEAE8",
    AMBER:     "B8941F", // attention (or foncé)
    AMBER_BG:  "FBF3DC"
  };

  // --- Polices --------------------------------------------------------------
  var FONT = {
    HEAD: "Montserrat",     // titres
    HEAD_B: "Montserrat",   // titres gras (bold via option)
    BODY: "Open Sans",      // texte courant
    SERIF: "Georgia"        // citations / éléments éditoriaux
  };

  // --- Géométrie du canevas (A4 paysage, 29,7 x 21,0 cm = 11,69 x 8,27 pouces)
  // Le deck est dimensionné au format A4 paysage : à l'impression / export PDF, il
  // remplit une feuille A4 sans bande ni rognage. Toute la mise en page dérive de
  // PAGE / CONTENT / FOOT_Y → un changement de format se propage automatiquement.
  var PAGE = { W: 11.69, H: 8.27 };
  var M = 0.55;                       // marge latérale
  var CONTENT = { x: M, w: PAGE.W - 2 * M };
  var HEAD_Y = 0.46;                  // haut du bandeau de titre
  var BODY_TOP = 1.62;                // haut de la zone de contenu
  var FOOT_Y = PAGE.H - 0.46;         // ligne de pied de page (marge basse constante)
  var COPYRIGHT = "© Propriété exclusive de Seine Gestion Privée";
  // Marque « active » du document (mode marque blanche) : renseignée par
  // generate(data) depuis les données du conseiller ; valeurs par défaut = charte Hexa.
  var BRAND = { firm: "Hexa Patrimoine — Maisons-Laffitte", firmShort: "HEXA PATRIMOINE", copyright: COPYRIGHT, logo: null };
  function setBrand(b) {
    b = b || {};
    BRAND.firm = (b.firm && String(b.firm).trim()) || "Hexa Patrimoine — Maisons-Laffitte";
    BRAND.firmShort = (b.firmShort && String(b.firmShort).trim()) || "HEXA PATRIMOINE";
    BRAND.copyright = (b.copyright && String(b.copyright).trim()) || COPYRIGHT;
    BRAND.logo = b.logo || null;
  }

  // ------------------------------------------------------------------------
  // Helpers bas niveau
  // ------------------------------------------------------------------------

  /** Fond plein page. */
  function fill(slide, color) {
    slide.addShape("rect", { x: 0, y: 0, w: PAGE.W, h: PAGE.H, fill: { color: color }, line: { type: "none" } });
  }

  /** Filet (ligne) horizontal ou vertical. */
  function rule(slide, x, y, w, h, color) {
    slide.addShape("rect", { x: x, y: y, w: w, h: h, fill: { color: color }, line: { type: "none" } });
  }

  /** Carte à coins arrondis avec ombre légère optionnelle. */
  function card(slide, x, y, w, h, opts) {
    opts = opts || {};
    var o = {
      x: x, y: y, w: w, h: h,
      fill: { color: opts.fill || COLORS.PAPER },
      line: opts.line === null ? { type: "none" } : { color: opts.line || COLORS.LINE, width: opts.lineW || 1 },
      rectRadius: opts.radius == null ? 0.09 : opts.radius
    };
    if (opts.shadow !== false) {
      o.shadow = { type: "outer", color: "9AA7B0", opacity: 0.28, blur: 6, offset: 2, angle: 90 };
    }
    slide.addShape("roundRect", o);
  }

  /** Badge / pastille texte (niveau de risque, étiquette…). */
  function pill(slide, x, y, w, h, text, bg, fg) {
    slide.addShape("roundRect", { x: x, y: y, w: w, h: h, fill: { color: bg }, line: { type: "none" }, rectRadius: h / 2 });
    slide.addText(text, {
      x: x, y: y, w: w, h: h, align: "center", valign: "middle",
      fontFace: FONT.HEAD, fontSize: 9, bold: true, color: fg, charSpacing: 0.5
    });
  }

  /**
   * Bandeau de titre standard (kicker + titre + filet or).
   * Retourne la coordonnée Y du bas du bandeau.
   */
  function header(slide, kicker, title, opts) {
    opts = opts || {};
    if (kicker) {
      slide.addText(String(kicker).toUpperCase(), {
        x: CONTENT.x, y: HEAD_Y, w: CONTENT.w, h: 0.3,
        fontFace: FONT.HEAD, fontSize: 11, bold: true, color: opts.kickerColor || COLORS.GOLD_DK,
        charSpacing: 2.2, align: "left", valign: "middle"
      });
    }
    slide.addText(title, {
      x: CONTENT.x, y: HEAD_Y + (kicker ? 0.28 : 0.08), w: CONTENT.w - 1.45, h: 0.72,
      fontFace: FONT.HEAD, fontSize: opts.titleSize || 25, bold: true,
      color: opts.titleColor || COLORS.PETROL, align: "left", valign: "middle"
    });
    // filet or court sous le titre
    rule(slide, CONTENT.x + 0.02, HEAD_Y + (kicker ? 1.06 : 0.86), 1.5, 0.045, COLORS.GOLD);
  }

  /** Logo Hexa en haut à droite (sur pastille blanche si fond foncé). */
  function logoTopRight(slide, opts) {
    opts = opts || {};
    var src = BRAND.logo || window.HEXA_LOGO_DATAURL;   // logo du cabinet (white-label), sinon logo par défaut
    if (!src) return;
    var W = 1.0, H = 0.58, x = PAGE.W - M - W, y = 0.24;
    if (opts.dark) {
      slide.addShape("roundRect", { x: x - 0.12, y: y - 0.06, w: W + 0.24, h: H + 0.12, fill: { color: "FFFFFF" }, line: { type: "none" }, rectRadius: 0.08 });
    }
    slide.addImage({ data: src, x: x, y: y, w: W, h: H, sizing: { type: "contain", w: W, h: H } });
  }

  /** Pied de page : nom du cabinet + pagination + logo. */
  function footer(slide, page, opts) {
    opts = opts || {};
    var darkBg = !!opts.dark;
    var lineColor = darkBg ? "12727C" : COLORS.LINE;
    var txtColor = darkBg ? "BFE0E5" : COLORS.SLATE_LT;
    rule(slide, M, FOOT_Y, PAGE.W - 2 * M, 0.012, lineColor);
    slide.addText(BRAND.firm, {
      x: M, y: FOOT_Y + 0.04, w: 5, h: 0.3, fontFace: FONT.BODY, fontSize: 8,
      color: txtColor, align: "left", valign: "middle"
    });
    slide.addText("Document confidentiel  ·  " + BRAND.copyright, {
      x: PAGE.W / 2 - 4, y: FOOT_Y + 0.04, w: 8, h: 0.3, fontFace: FONT.BODY, fontSize: 8,
      color: txtColor, align: "center", valign: "middle"
    });
    if (page != null) {
      slide.addText(String(page), {
        x: PAGE.W - M - 1, y: FOOT_Y + 0.04, w: 1, h: 0.3, fontFace: FONT.HEAD, fontSize: 8,
        bold: true, color: darkBg ? COLORS.GOLD : COLORS.SLATE, align: "right", valign: "middle"
      });
    }
  }

  /**
   * Crée un slide « standard » : fond blanc, bandeau de titre, pied de page.
   * Retourne { slide, body:{x,y,w,h} } pour positionner le contenu.
   */
  function standardSlide(pptx, opts) {
    opts = opts || {};
    var slide = pptx.addSlide();
    slide.background = { color: opts.bg || COLORS.PAPER };
    if (opts.bg && opts.bg !== COLORS.PAPER) fill(slide, opts.bg);
    if (opts.title) header(slide, opts.kicker, opts.title, opts);
    logoTopRight(slide, { dark: opts.bg && opts.bg !== COLORS.PAPER });
    footer(slide, opts.page);
    var top = opts.bodyTop || BODY_TOP;
    return {
      slide: slide,
      body: { x: CONTENT.x, y: top, w: CONTENT.w, h: FOOT_Y - top - 0.12 }
    };
  }

  /** Slide intercalaire de section (grand numéro + titre, fond pétrole). */
  function divider(pptx, opts) {
    var slide = pptx.addSlide();
    slide.background = { color: COLORS.PETROL };
    fill(slide, COLORS.PETROL);
    // halo décoratif
    slide.addShape("ellipse", { x: 9.6, y: -2.2, w: 6.5, h: 6.5, fill: { color: COLORS.PETROL_LT }, line: { type: "none" } });
    slide.addShape("ellipse", { x: 11.2, y: 3.4, w: 5.2, h: 5.2, fill: { color: COLORS.PETROL_DK }, line: { type: "none" } });
    // barre or verticale
    rule(slide, M, 2.76, 0.09, 2.76, COLORS.GOLD);
    // grand numéro
    if (opts.num != null) {
      slide.addText(String(opts.num), {
        x: 8.29, y: 1.1, w: 3.2, h: 6.06, fontFace: FONT.HEAD, fontSize: 200, bold: true,
        color: COLORS.GOLD, align: "center", valign: "middle", transparency: 18
      });
    }
    if (opts.kicker) {
      slide.addText(String(opts.kicker).toUpperCase(), {
        x: M + 0.32, y: 2.81, w: 8, h: 0.4, fontFace: FONT.HEAD, fontSize: 13, bold: true,
        color: COLORS.GOLD, charSpacing: 3, align: "left", valign: "middle"
      });
    }
    slide.addText(opts.title, {
      x: M + 0.32, y: 3.25, w: 8.3, h: 1.5, fontFace: FONT.HEAD, fontSize: 40, bold: true,
      color: COLORS.PAPER, align: "left", valign: "middle"
    });
    if (opts.subtitle) {
      slide.addText(opts.subtitle, {
        x: M + 0.34, y: 4.91, w: 8, h: 0.6, fontFace: FONT.BODY, fontSize: 15,
        color: COLORS.TEAL_PALE, align: "left", valign: "middle"
      });
    }
    slide.addText(BRAND.firmShort, {
      x: M + 0.32, y: 7.17, w: 6, h: 0.4, fontFace: FONT.HEAD, fontSize: 11, bold: true,
      color: "7FBFC8", charSpacing: 3, align: "left", valign: "middle"
    });
    slide.addText(BRAND.copyright, {
      x: M + 0.32, y: 7.61, w: 9, h: 0.3, fontFace: FONT.BODY, fontSize: 8.5, color: "6FB0BA", align: "left", valign: "middle"
    });
    logoTopRight(slide, { dark: true });
    return slide;
  }

  /**
   * Grille de cartes (layout pédagogique « 6 boîtes »).
   * cards: [{ title, body, accent? }]  cols: nb colonnes
   */
  function cardGrid(slide, region, cards, opts) {
    opts = opts || {};
    var cols = opts.cols || 3;
    var rows = Math.ceil(cards.length / cols);
    var gap = opts.gap == null ? 0.22 : opts.gap;
    var cw = (region.w - gap * (cols - 1)) / cols;
    var ch = (region.h - gap * (rows - 1)) / rows;
    cards.forEach(function (c, i) {
      var r = Math.floor(i / cols), col = i % cols;
      var x = region.x + col * (cw + gap);
      var y = region.y + r * (ch + gap);
      var accent = c.accent || COLORS.PETROL;
      card(slide, x, y, cw, ch, { fill: COLORS.MIST, line: COLORS.LINE });
      // bande d'accent supérieure
      slide.addShape("roundRect", { x: x, y: y, w: cw, h: 0.12, fill: { color: accent }, line: { type: "none" }, rectRadius: 0.05 });
      var pad = 0.2;
      // titleTop / bodyTop : décalage vertical du titre et du corps depuis le haut
      // de la carte (par défaut 0,2 / 0,72). Permet de réserver un en-tête (ex. un
      // numéro centré) en descendant le texte, sans changer les autres appels.
      var titleTop = opts.titleTop == null ? 0.2 : opts.titleTop;
      var bodyTop = opts.bodyTop == null ? 0.72 : opts.bodyTop;
      slide.addText(c.title, {
        x: x + pad, y: y + titleTop, w: cw - 2 * pad, h: 0.5,
        fontFace: FONT.HEAD, fontSize: opts.titleSize || 12.5, bold: true, color: COLORS.PETROL,
        align: opts.titleAlign || "left", valign: "top"
      });
      slide.addText(c.body, {
        x: x + pad, y: y + bodyTop, w: cw - 2 * pad, h: ch - bodyTop - 0.14,
        fontFace: FONT.BODY, fontSize: opts.bodySize || 10, color: COLORS.SLATE,
        align: "left", valign: "top", lineSpacingMultiple: 1.05
      });
    });
  }

  /** Bloc indicateur clé (valeur + libellé). */
  function kpi(slide, x, y, w, h, value, label, opts) {
    opts = opts || {};
    card(slide, x, y, w, h, { fill: opts.fill || COLORS.PETROL, line: null, shadow: opts.shadow !== false });
    slide.addText(String(value), {
      x: x + 0.1, y: y + h * 0.14, w: w - 0.2, h: h * 0.5,
      fontFace: FONT.HEAD, fontSize: opts.valueSize || 26, bold: true,
      color: opts.valueColor || COLORS.PAPER, align: "center", valign: "middle"
    });
    slide.addText(String(label).toUpperCase(), {
      x: x + 0.1, y: y + h * 0.62, w: w - 0.2, h: h * 0.32,
      fontFace: FONT.HEAD, fontSize: opts.labelSize || 9, bold: false,
      color: opts.labelColor || COLORS.TEAL_PALE, align: "center", valign: "middle", charSpacing: 1
    });
  }

  // Expose le namespace
  window.HEXA = {
    COLORS: COLORS, FONT: FONT, PAGE: PAGE, M: M, CONTENT: CONTENT,
    HEAD_Y: HEAD_Y, BODY_TOP: BODY_TOP, FOOT_Y: FOOT_Y, COPYRIGHT: COPYRIGHT, brand: BRAND, setBrand: setBrand,
    fill: fill, rule: rule, card: card, pill: pill, header: header, footer: footer, logoTopRight: logoTopRight,
    standardSlide: standardSlide, divider: divider, cardGrid: cardGrid, kpi: kpi
  };
})();
