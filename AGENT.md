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

## Sonst

- Prompt und Beispiele: `server/llm.js` (`SYSTEM_PROMPT`). Beispiele mit beiden Ausgangs-Redewendungen angeben;
  fehlen diese in der Liste, dort ergänzen (und Schritt 1–4 oben).
- Modellkatalog (Denksteuerung, empfohlene Einstellungen je Modell): `server/models.js`.
- Paarauswahl und Gewichte der Quellen: `server/pairs.js`, Umgebungsvariable `PAIR_WEIGHTS`.
