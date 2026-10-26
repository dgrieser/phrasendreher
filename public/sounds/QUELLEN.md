# Geräusche

| Datei | Verwendung | Quelle |
|---|---|---|
| `lever-return.wav` | Hebel schnellt zurück und schlägt oben an | Aufnahme „Slot machine big lever“, vom Projekt bereitgestellt; Stille am Anfang gekürzt, Mono, normalisiert |
| `win.mp3` | Ganze Redewendung steht | Aufnahme „Slot machine win“, vom Projekt bereitgestellt; auf 2 s gekürzt und ausgeblendet, normalisiert |

`lever-return.wav` beginnt mit dem Auslösen der Feder; der Anschlag liegt 0,125 s nach Beginn (`LEVER_IMPACT` in
`public/app.js`). Die Aufnahme wird so früh gestartet, dass dieser Anschlag mit dem oberen Anschlag des Hebels
zusammenfällt.

Alle übrigen Geräusche (Ratsche, Einrasten, Walzen, Sperre, unterer Anschlag) erzeugt `public/app.js` live mit der
Web Audio API.
