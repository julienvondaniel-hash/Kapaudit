"""
build_standalone.py — Génère le fichier HTML « autonome » (tout-en-un).

Reprend docs/index.html et y intègre, en ligne :
  - la feuille de style docs/css/style.css
  - les 9 scripts docs/js/*.js, dans l'ordre de chargement de index.html

Les bibliothèques externes (PptxGenJS via CDN, Google Fonts) restent
référencées par URL : une connexion Internet est nécessaire pour générer
le PowerPoint, mais le formulaire et le livret A4 fonctionnent hors ligne.

Usage :
    python3 build_standalone.py
Produit : HEXA_Etude_Patrimoniale_autonome.html (à la racine du dépôt).
"""
import pathlib

ROOT = pathlib.Path(__file__).parent
docs = ROOT / "docs"
html = (docs / "index.html").read_text(encoding="utf-8")

# Feuille de style en ligne
css = (docs / "css" / "style.css").read_text(encoding="utf-8").replace("</style>", "<\\/style>")
link = '<link rel="stylesheet" href="css/style.css" />'
assert link in html, "lien CSS introuvable dans index.html"
html = html.replace(link, "<style>\n" + css + "\n</style>")

# Scripts applicatifs en ligne, dans l'ordre exact de index.html
order = ["logo-data.js", "hexa-brand.js", "hexa-succession.js", "hexa-compute.js",
         "hexa-content.js", "hexa-slides.js", "hexa-form.js", "hexa-print.js", "app.js"]
for name in order:
    js = (docs / "js" / name).read_text(encoding="utf-8").replace("</script>", "<\\/script>")
    tag = '<script src="js/%s"></script>' % name
    assert tag in html, "balise script introuvable : " + tag
    html = html.replace(tag, "<script>\n" + js + "\n</script>")

# Le fichier autonome reste en mode LOCAL : on retire le bloc « cloud »
# (commentaire + config publique + couche Supabase). Non inlinés, ces scripts
# seraient des références externes mortes hors ligne ; l'app tourne en localStorage.
html = html.replace(
    '  <!-- Couche cloud (SaaS) : inerte tant que hexa-config.js est vide ; retirée du fichier autonome. -->\n', "")
for name in ("hexa-config.js", "hexa-cloud.js", "hexa-saas.js"):
    tag = '<script src="js/%s"></script>' % name
    html = html.replace("  " + tag + "\n", "").replace(tag + "\n", "").replace(tag, "")

out = ROOT / "HEXA_Etude_Patrimoniale_autonome.html"
out.write_text(html, encoding="utf-8")
print("Écrit :", out.name, "(", out.stat().st_size, "octets )")
