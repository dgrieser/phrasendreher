# 🎰 Phrasendreher

Der einarmige Bandit für verdrehte Redewendungen. Hebel ziehen (oder Regler schieben) – und schon heißt es
„Da muss man die Küche im Dorf lassen“.

## Wie wird verdreht?

`dreher.js` mischt die Redewendungen aus `redewendungen.js` auf zwei Arten:

- **Substantiv-Tausch:** Ein Substantiv wird durch eins aus einer anderen Redewendung ersetzt – aber nur, wenn
  davor derselbe Artikel steht („in die *Wunde*“ → „in die *Kuh*“), damit es grammatisch halbwegs passt.
- **Zusammenkleben:** Anfang der einen und Ende der anderen Redewendung werden an einem gemeinsamen Wort
  („in den“, „wie“, „und“ …) verbunden: „Den Kopf in den Sand stecken“ + „Den Hut in den Ring werfen“.

Die drei Walzen zeigen genau diese drei Teile. Ab und zu fällt ein handverlesener Klassiker als Jackpot.

## Neue Redewendungen

Einfach eine Zeile in `redewendungen.js` ergänzen. Klassiker stehen oben in `app.js` (`KLASSIKER`).

## Lokal ansehen

`index.html` im Browser öffnen – kein Build nötig.

## Veröffentlichen

Der Workflow `.github/workflows/pages.yml` veröffentlicht bei jedem Push auf `main`.
Einmalig unter *Settings → Pages → Source* „GitHub Actions“ auswählen.
