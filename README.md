# 🎰 Phrasendreher

Der einarmige Bandit für verdrehte Redewendungen. Hebel ziehen (oder Regler schieben) – die Walzen drehen,
bis ein LLM aus zwei Redewendungen eine neue, schön schiefe gemacht hat.

## Starten

```sh
cp .env.example .env      # LLM_API_KEY und LLM_MODEL eintragen
docker compose up --build
```

Dann <http://localhost:8080> öffnen. Ohne Compose:

```sh
docker build -t phrasendreher .
docker run -p 8080:8080 -e LLM_API_KEY=sk-... -e LLM_MODEL=Qwen3.8-27B-NVFP4 phrasendreher
```

Fertige Images baut der Workflow `.github/workflows/docker.yml` nach `ghcr.io/dgrieser/phrasendreher`:

| Tag | Quelle |
|---|---|
| `edge` | letzter Stand von `main` |
| `latest` | letztes Git-Tag (z. B. `v1.0.0`) |
| `v1.0.0` usw. | das jeweilige Git-Tag |
| `sha-…` | jeder gebaute Commit |

Nach jedem Build auf `main` oder für ein Tag ruft der Workflow den Pull-Image-Webhook des
mittwald-Container-Services auf. Der zieht das neue Image und startet den Service neu.
Dafür die Webhook-URL (inklusive `?token=…`) als Repository-Secret `MITTWALD_WEBHOOK_URL`
hinterlegen (*Settings → Secrets and variables → Actions*). Ohne Secret wird nur gebaut.

## Konfiguration (Umgebungsvariablen)

Standardmäßig wird [mittwald AI Hosting](https://developer.mittwald.de/de/docs/v2/platform/aihosting/models/qwen3-8-27b-nvfp4)
verwendet (OpenAI-kompatible API). Nötig sind nur API-Key und Modell. Alle übrigen Werte folgen ohne eigene Angabe
den mittwald-Empfehlungen für das gewählte Modell (Katalog in `server/models.js`).

| Variable | Standard | Bedeutung |
|---|---|---|
| `LLM_API_KEY` | – | API-Key (ohne Key dreht nur der eingebaute Mischmotor) |
| `LLM_MODEL` | `Qwen3.8-27B-NVFP4` | Modellname |
| `LLM_BASE_URL` | `https://llm.aihosting.mittwald.de/v1` | Beliebiger OpenAI-kompatibler Endpunkt |
| `LLM_ENABLE_THINKING` | je nach Modell | Thinking an/aus, sofern das Modell es erlaubt |
| `LLM_REASONING_EFFORT` | je nach Modell | Denkstufe, z. B. `low`/`medium`/`xhigh` (Qwen3.8) oder `low`/`medium`/`high` (gpt-oss) |
| `LLM_TEMPERATURE` | Empfehlung des Modells | |
| `LLM_TOP_P` | Empfehlung des Modells | |
| `LLM_TOP_K` | Empfehlung des Modells | |
| `LLM_PRESENCE_PENALTY` | Empfehlung des Modells | |
| `LLM_MAX_TOKENS` | `4096` | inkl. Denk-Tokens |
| `LLM_TIMEOUT_MS` | `45000` | danach greift die Notlösung |
| `TEST_PAGE` | `true` | Testseite `/test` an/aus |
| `TEST_USER`, `TEST_PASSWORD` | – | Sind beide gesetzt, verlangt das Testlabor eine Anmeldung (HTTP Basic Auth) |
| `RATE_LIMIT_SPIN` | `20/min` | Anfragen pro IP an den Automaten (`/api/dreh`); `off` schaltet ab |
| `RATE_LIMIT_TEST` | `10/10min` | Läufe pro IP im Testlabor (`/api/test`); `off` schaltet ab |
| `PAIR_WEIGHTS` | `meaning:50,image:25,sound:10,grammar:15` | Gewichte der Partner-Quellen (siehe unten) |
| `TRUST_PROXY` | `true` | IP aus `X-Forwarded-For` lesen (hinter einem Proxy wie bei mittwald); ohne Proxy auf `false` setzen |
| `PORT` | `8080` | |

## Wie wird verdreht?

1. **Erste Redewendung:** kommt aus einem gemischten Stapel – jede ist einmal dran, bevor neu gemischt wird.
   So kommen alle Redewendungen gleich oft vor.
2. **Zweite Redewendung:** ein Partner, der zur ersten passt (`server/pairs.js`), aus einer von vier Quellen:

   | Quelle | Partner | Woher |
   |---|---|---|
   | `meaning` | ähnliche Bedeutung („Nur Bahnhof verstehen“ ↔ „Auf dem Schlauch stehen“) | `server/data/partners.json` |
   | `image` | ähnliches Bild oder Wort („Auf Granit beißen“ ↔ „Ins Gras beißen“) | `server/data/partners.json` |
   | `sound` | ähnlicher Klang oder Reim („Sinn“ ↔ „Finn“, „Schnippchen“ ↔ „Schnäppchen“) | Kölner Phonetik, beim Start berechnet |
   | `grammar` | gleicher Artikel vor einem Substantiv oder gemeinsames Gelenkwort („in den“, „wie“) | Mischmotor `public/dreher.js` |

   Die Quelle wird nach `PAIR_WEIGHTS` gewürfelt – nur unter denen, die für die Redewendung Partner haben.
   Kürzlich verwendete Paare werden ausgelassen.
3. Der Server (`server/`) schickt beide an das LLM, das daraus eine neue Redewendung macht
   (Prompt in `server/llm.js`).
4. Die Walzen drehen, bis die Antwort da ist. Fällt das LLM aus, nimmt der Server die eigene Mischung des
   Mischmotors – es kommt also immer etwas heraus.

`server/data/partners.json` enthält zu jeder Redewendung eine Umschreibung ihrer Bedeutung (per LLM, von Hand
korrigiert) und die jeweils zehn nächsten Nachbarn nach Bedeutung und nach Bild (Embeddings mit
`Qwen3-Embedding-8B`). Erzeugt wird die Datei mit `scripts/build-partners.js` – nach jeder Änderung an der
Liste, siehe [`AGENT.md`](AGENT.md).

## Der Automat in 3D

Der Automat ist ein 3D-Modell aus [Blender](https://www.blender.org): Mahagoni-Gehäuse mit gemasertem Furnier unter
Klarlack, Messingrahmen, Namensschild mit erhabenen Lettern auf roter Emaille, Glühbirnen in Chromfassungen, ein
geschliffener Rubin, Münzeinwurf, Schlossblech und der Hebel an der Seitenwand. Das ganze Modell entsteht aus Code
(`blender/automat.py`) und wird mit Cycles fotorealistisch gerendert (`blender/render.py`, Anleitung in
[`AGENT.md`](AGENT.md)).

Ist alles geladen, erscheint im Ladebildschirm „Starten“. Der Druck darauf spielt einen stillen Ton – das schaltet den
Ton für die ganze Seite frei, auch auf Telefonen, die ihn sonst erst beim Loslassen des Fingers erlauben. Dann fliegt
die Kamera in einem vorab gerenderten Video (`intro.mp4`/`intro.webm`, 2,5 s) von schräg oben rechts
zur Frontalansicht; das letzte Bild des Videos ist genau die Spielansicht, dort wird auf den Live-Automaten
überblendet. Während des Flugs ist der Hebel gesperrt. Bei „Bewegung reduzieren“ (oder wenn das Video nicht abspielt)
steht der Automat gleich frontal da.

Gespielt wird frontal, auf Augenhöhe. Im Browser setzt [three.js](https://threejs.org) (MIT, mitgeliefert in
`public/vendor/`) den Automaten zusammen (`public/machine3d.js`), mit genau der Kamera des Renders:

- **Gehäuse:** das gerenderte Bild (`public/automat/automat.webp`), mit Löchern, wo die Walzen hindurchscheinen.
- **Walzen:** live gezeichnet, mit den Texten auf zwölf Seiten je Walze und Bewegungsunschärfe. Licht, Schatten des
  Fensterschachts und die Spiegelung der Glasscheibe kommen aus dem Render (`walzen.webp`).
- **Glühbirnen:** das gerenderte Leuchten aller Birnen samt Licht auf Holz und Messing (`gluehen.webp`) wird pro Birne
  ein- und ausgeblendet – mit kurzem An- und Nachglühen wie bei echten Glühfäden.
- **Hebel:** das Modell aus Blender (`hebel.glb`), gespiegelt in einer Rundum-Aufnahme vom Hebel aus (`umgebung.hdr`),
  mit weichem Schatten auf der Seitenwand.

Die Leinwand hat das Seitenverhältnis des Renders und passt sich jeder Bildschirmbreite an. Bis der Automat fertig
gezeichnet ist, steht ein Ladebildschirm im selben Stil (`public/loader.js`): Die Glühbirnen zeigen den echten
Ladefortschritt, eine Fallblattanzeige verdreht bekannte Redewendungen zu Lade-Weisheiten. Ohne WebGL gibt es nur
einen Hinweis. Beim Gewinnton fliegt Konfetti von unten herein und hinter dem Automaten herab (bei „Bewegung
reduzieren“ nicht). Texturen, Umgebung und Schrift fürs Rendern: [`public/automat/QUELLEN.md`](public/automat/QUELLEN.md).

Die meisten Geräusche entstehen live mit der Web Audio API. Das Anlaufen der Walzen, das Zurückschnellen des Hebels
und der Gewinnton beim Ergebnis sind Aufnahmen in `public/sounds/`, Details in [`public/sounds/QUELLEN.md`](public/sounds/QUELLEN.md).
Sie werden schon während des Ladebildschirms geladen und dekodiert, der Ton wird mit „Starten“ freigeschaltet – so
klingt schon der erste Zug richtig, samt Ratsche.

## Testlabor

Unter `/test` lassen sich Prompt und Modell ausprobieren: zwei Redewendungen wählen (oder würfeln),
den System-Prompt bearbeiten und zusehen, wie das Modell live denkt und antwortet. Die Änderungen am
Prompt gelten nur für diesen Testlauf – dauerhaft wird er in `server/llm.js` geändert.
Modell, Profil, Thinking, Denkstufe und Sampling-Parameter sind dort wählbar. Die Modellliste kommt live aus
`/v1/models` (was der Key darf) und der mittwald-API (Anzeigename, Reifegrad, Token-Faktor, Doku-Link). Wie ein
Modell sein Denken steuert und welche Einstellungen mittwald empfiehlt, steht in `server/models.js` – die Profile
im Testlabor sind genau diese Empfehlungen.
Mit `TEST_USER` und `TEST_PASSWORD` verlangt das Testlabor eine Anmeldung (HTTP Basic Auth) – für die Seite und ihre
Schnittstellen (`/api/test`, `/api/prompt`, `/api/pair`, `/api/models`); der Automat selbst bleibt offen. Ohne die beiden
Variablen ist das Testlabor für alle erreichbar, der Server weist beim Start darauf hin. Basic Auth schickt das Passwort
bei jeder Anfrage mit – nur über HTTPS betreiben (bei mittwald der Fall).
Mit `TEST_PAGE=false` ist die Seite abgeschaltet.

## Ratenbegrenzung

Jede IP darf den Automaten und das Testlabor nur begrenzt oft nutzen (Formate wie `30/min`, `5/10s`, `100/h`).
Wird die Grenze erreicht, antwortet der Server mit `429` und `Retry-After`. Der Automat dreht dann trotzdem –
mit der Handmischung des Mischmotors statt des LLM –, das Testlabor zeigt die Wartezeit an.
Die Zähler liegen im Speicher und gelten pro Container-Instanz.

Neue Redewendungen: eine Zeile in `public/redewendungen.js` ergänzen und danach die Partnerdaten aktualisieren
(`LLM_API_KEY=… node scripts/build-partners.js`, Details in [`AGENT.md`](AGENT.md)).
