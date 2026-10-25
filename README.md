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
verwendet (OpenAI-kompatible API). Nötig sind nur API-Key und Modell, alles andere hat sinnvolle Standardwerte.

| Variable | Standard | Bedeutung |
|---|---|---|
| `LLM_API_KEY` | – | API-Key (ohne Key dreht nur der eingebaute Mischmotor) |
| `LLM_MODEL` | `Qwen3.8-27B-NVFP4` | Modellname |
| `LLM_BASE_URL` | `https://llm.aihosting.mittwald.de/v1` | Beliebiger OpenAI-kompatibler Endpunkt |
| `LLM_ENABLE_THINKING` | `true` | Thinking an/aus (`chat_template_kwargs.enable_thinking`) |
| `LLM_REASONING_EFFORT` | `medium` | `low`, `medium` oder `xhigh` |
| `LLM_TEMPERATURE` | `1.0` (ohne Thinking `0.7`) | |
| `LLM_TOP_P` | `0.95` (ohne Thinking `0.8`) | |
| `LLM_TOP_K` | `20` | |
| `LLM_PRESENCE_PENALTY` | `0.0` (ohne Thinking `1.5`) | |
| `LLM_MAX_TOKENS` | `4096` | inkl. Denk-Tokens |
| `LLM_TIMEOUT_MS` | `45000` | danach greift die Notlösung |
| `PORT` | `8080` | |

## Wie wird verdreht?

1. Der Mischmotor (`public/dreher.js`) sucht zwei Redewendungen aus `public/redewendungen.js`, die sich gut
   kombinieren lassen (gleicher Artikel vor einem Substantiv oder ein gemeinsames Gelenkwort wie „in den“).
2. Der Server (`server/`) schickt beide an das LLM, das daraus eine neue Redewendung macht
   (Prompt in `server/llm.js`).
3. Die Walzen drehen, bis die Antwort da ist. Fällt das LLM aus, nimmt der Server die eigene Mischung des
   Mischmotors – es kommt also immer etwas heraus.

Neue Redewendungen: einfach eine Zeile in `public/redewendungen.js` ergänzen.
