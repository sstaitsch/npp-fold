# Npp Fold

Editor im Stil von Notepad++ für Android, optimiert für das Samsung Galaxy Z Fold
(zwei Ansichten nebeneinander im aufgeklappten Zustand). Inoffiziell – nicht mit dem Notepad++-Projekt verbunden.

## Installieren
Neueste APK: **Releases → `NppFold.apk`**. Danach aktualisiert sich die App selbst
(Menü ⋮ → *Nach Updates suchen*, oder automatisch alle 6 Stunden beim Start).

## Neue Version veröffentlichen
Jeder Push auf `main` baut per GitHub Actions eine signierte APK und legt ein Release an.
Die Commit-Nachricht erscheint in der App als „Neu: …“.

Benötigte Repository-Secrets: `KEYSTORE_BASE64` (base64 der release.keystore), `KEYSTORE_PASSWORD`.

## Aufbau
- `web/` – Editor-Oberfläche (CodeMirror 6), gebündelt mit esbuild
- `app/` – Android-Hülle (Java, WebView, Dateizugriff, Selbst-Update)
- `build.sh` – Build ohne Gradle (aapt2, javac, d8, apksigner)
