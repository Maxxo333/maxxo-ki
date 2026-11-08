# Maxxo KI Mobil

Die Web-Version von **Maxxo KI**, deinem persönlichen KI-Assistenten, für iPhone, Android und jeden Browser. Sie läuft komplett im Browser. Es gibt keinen eigenen Server, und dein Mac muss nicht eingeschaltet sein.

**Adresse:** https://maxxo333.github.io/maxxo-ki/

## Was die App kann

| Funktion | Woher |
|---|---|
| Fragen beantworten, erklären, programmieren | **Claude Haiku 5.5** (Anthropic), fest eingestellt |
| Websuche mit Quellenangaben, wenn nötig | **Tavily** (1.000 Suchen pro Monat kostenlos) |
| Verlauf, Einstellungen, Schlüssel | nur **in deinem Browser** auf diesem Gerät |

**Nicht enthalten** (das gibt es nur in der Mac-Version):
- Tor und .onion-Quellen. Browser können keine Tor-Verbindung aufbauen.
- Lesen der vollständigen Quellseiten. Die Web-Version nutzt nur die Suchausschnitte von Tavily.

## Einrichtung auf dem Handy
1. Die Adresse oben öffnen: auf dem iPhone in **Safari**, auf Android in **Chrome**.
2. Als App auf den Home-Bildschirm legen:
   - iPhone: Teilen-Symbol → **„Zum Home-Bildschirm“**
   - Android: Menü ⋮ → **„Zum Startbildschirm hinzufügen“** bzw. „App installieren“
3. Die App öffnen, dann Zahnrad → **Schlüssel** → Claude-Schlüssel (`sk-ant-…`) und optional Tavily-Schlüssel (`tvly-…`) einfügen → **Speichern**.

## Sicherheit und Datenschutz
- Deine Schlüssel stehen **nicht** im Quellcode und nicht auf GitHub. Sie werden **nur auf deinem Gerät** im Browser gespeichert und **nur direkt** an `api.anthropic.com` bzw. `api.tavily.com` gesendet.
- **Ehrlicher Hinweis:** Wer dein **entsperrtes** Gerät benutzt, könnte die Schlüssel auslesen. Anthropic bezeichnet diese Browser-Nutzung deshalb selbst als „dangerous“. Absichern kannst du dich so:
  - In der Anthropic Console ein **monatliches Ausgabenlimit** setzen (z. B. 5 $).
  - Einen **eigenen Schlüssel nur fürs Handy** anlegen, z. B. „Maxxo KI iPhone“. Geht das Handy verloren, löschst du diesen Schlüssel einfach in der Console.
- Es gibt keine Tracker, keine Werbung und keine externen Schriftarten oder Skripte. Eine strenge Content-Security-Policy erlaubt Verbindungen nur zu Anthropic und Tavily.
- Was an wen geht:
  - **Anthropic:** die letzten Nachrichten der aktuellen Unterhaltung, plus die Suchtreffer.
  - **Tavily:** nur die Suchanfrage, aus der E-Mail-Adressen, Telefonnummern und IBANs automatisch entfernt werden.
  - **GitHub:** liefert nur die Dateien der App aus. Dabei kann GitHub Zugriffe protokollieren, siehe GitHub-Datenschutzerklärung.
- Unter Einstellungen kannst du den Verlauf löschen oder **alles löschen**, also Verlauf und Schlüssel.

## Kosten
- **Claude Haiku 5.5:** Eine Frage kostet in der Regel nur einen Bruchteil eines Cents. Abgerechnet wird über dein Anthropic-Guthaben, das vorab aufgeladen wird und ohne Abo läuft.
- **Tavily:** 1.000 Credits pro Monat kostenlos, ohne Kreditkarte. Ist das Kontingent aufgebraucht, sagt die App das, und die Websuche pausiert bis zum nächsten Monat.
- **GitHub Pages:** kostenlos.

## Technik
- Reines HTML, CSS und JavaScript ohne Build-Schritt. Ein Service Worker lädt die App auch offline; zum Senden braucht es aber Internet.
- `engine.js`: Recherche-Ablauf und Claude-Anbindung über das offizielle Anthropic-SDK (`vendor/anthropic-sdk.js`, Version 1.6.0, gebündelt mit esbuild; Lizenz in `vendor/`).
- `markdown.js`: eigener, XSS-sicherer Markdown-Renderer.
