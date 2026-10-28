# Quellen für den gerenderten Automaten

Das Modell selbst ist Eigenbau (`blender/automat.py`). Zum Rendern werden diese freien Dateien verwendet; sie liegen
nicht im Repository, `blender/automat.py` lädt sie beim ersten Lauf nach `blender/assets/`.

| Datei | Wofür | Quelle | Lizenz |
|---|---|---|---|
| Natural Walnut Veneer (2k: Farbe, Rauheit, Normalen) | Furnier der Front, zu Mahagoni getönt | [Poly Haven](https://polyhaven.com/a/natural_walnut_veneer) | CC0 |
| Lacquered Cherry Wood (2k: Farbe, Rauheit, Normalen) | Seitenwände | [Poly Haven](https://polyhaven.com/a/lacquered_cherry_wood) | CC0 |
| Billiard Hall (HDRI, 2k) | Umgebungslicht und Spiegelungen | [Poly Haven](https://polyhaven.com/a/billiard_hall) | CC0 |
| Rokkitt Black, ExtraBold | Schriftzug auf dem Namensschild, bedruckte Walzen im Intro | [Google Fonts](https://fonts.google.com/specimen/Rokkitt) | SIL Open Font License 1.1 |

Die Dateien in diesem Ordner (`automat.webp`, `gluehen.webp`, `walzen.webp`, `umgebung.hdr`, `hebel.glb`,
`intro.mp4`, `intro.webm`, `szene.json`) erzeugt `blender/render.py`.
