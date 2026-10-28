# Hinweise für Agenten

## Redewendungen hinzufügen, ändern oder entfernen

Die Liste steht in `public/redewendungen.js`. Zu jeder Redewendung gehören Partnerdaten in
`server/data/partners.json`, aus denen der Server passende Paare für das LLM wählt. **Nach jeder Änderung an
der Liste müssen diese Daten nachgezogen werden:**

1. Partnerdaten aktualisieren (braucht einen API-Key für mittwald AI Hosting):

   ```sh
   LLM_API_KEY=… node scripts/build-partners.js
   ```

   Das Skript erzeugt nur für neue Einträge eine Umschreibung der Bedeutung (`meaning`), übernimmt alle
   vorhandenen – auch von Hand korrigierte – und berechnet danach die Nachbarn (`similar`, `image`) für die
   ganze Liste neu. Entfernte Redewendungen fallen dabei automatisch heraus. Bei einer geänderten Redewendung
   gilt der neue Wortlaut als neuer Eintrag.

2. Die neuen Umschreibungen in `server/data/partners.json` prüfen. Das LLM liegt bei Ironie, Regionalismen
   und seltenen Redewendungen öfter daneben (z. B. „Reibach machen“ = großer Gewinn, nicht Verlust). Falsche
   Umschreibungen direkt in der Datei korrigieren und das Skript erneut ausführen, damit die Nachbarn zur
   Korrektur passen.

3. Prüfen, dass Liste und Daten zusammenpassen:

   ```sh
   node scripts/build-partners.js --check
   ```

4. `public/redewendungen.js` und `server/data/partners.json` gemeinsam committen.

Klang-Partner (Kölner Phonetik, Reime) und grammatische Partner (Mischmotor in `public/dreher.js`) berechnet der
Server beim Start selbst – dafür ist nichts zu tun.

`--all` erzeugt alle Umschreibungen neu und **überschreibt dabei alle Handkorrekturen**. Nur verwenden, wenn
das ausdrücklich gewünscht ist.

## Den Automaten ändern (Blender)

Das Modell steht als Code in `blender/automat.py` (Maße oben in der Datei, Materialien, Bauteile, Licht, Kamera).
`blender/render.py` baut die Szene, rendert mit Cycles und schreibt alles nach `public/automat/`. Nach jeder Änderung am
Modell neu rendern und die Dateien in `public/automat/` mit committen:

```sh
python3 -m venv .venv-blender && .venv-blender/bin/pip install -r blender/requirements.txt
.venv-blender/bin/python blender/render.py --quick   # Vorschau in ~1 min (600 px, wenige Samples)
.venv-blender/bin/python blender/render.py           # endgültig mit Intro – auf 4 Kernen rund 3 Stunden
.venv-blender/bin/python blender/render.py --ohne-intro   # nur die Spielansicht (gut 30 min)
.venv-blender/bin/python blender/render.py --nur-intro    # nur den Kameraflug (Video, braucht ffmpeg)
```

Das Intro (Startwinkel, Dauer, Bildrate) steht oben im Abschnitt „Intro“ von `render.py`. Sein letztes Bild muss zur
Spielansicht passen – nach Änderungen am Modell daher immer beides neu rendern.

Texturen, Umgebung und Schrift lädt das Skript beim ersten Lauf nach `blender/assets/` (nicht eingecheckt).
`blender/build/automat.blend` ist die fertige Szene zum Ansehen in Blender, ebenfalls nicht eingecheckt.

- Walzen: Lage, Radius und Breite gehen über `szene.json` an `public/machine3d.js` – die Zahl der Seiten (`N = 12`)
  muss zu `public/app.js` passen.
- Hebel: Endanschlag `LEVER_MAX` in `render.py` und `machine3d.js` gleich `MAX` in `app.js` halten.
- Nach einem neuen Render das Seitenverhältnis in `public/style.css` (`.machine { aspect-ratio }`) an `bild` in
  `public/automat/szene.json` anpassen (sonst springt die Seite kurz beim Laden).

## Sonst

- Prompt und Beispiele: `server/llm.js` (`SYSTEM_PROMPT`). Beispiele mit beiden Ausgangs-Redewendungen angeben;
  fehlen diese in der Liste, dort ergänzen (und Schritt 1–4 oben).
- Modellkatalog (Denksteuerung, empfohlene Einstellungen je Modell): `server/models.js`.
- Paarauswahl und Gewichte der Quellen: `server/pairs.js`, Umgebungsvariable `PAIR_WEIGHTS`.
