# Malmökartan — total ombyggnad (design)

Status: godkänd av Fredrik 2026-08-28, redo för implementeringsplan.

## Bakgrund

"Malmökartan — lär dig stadsdelarna" är idag en [Claude Artifact](https://claude.ai/code/artifact/5bb61e81-8572-436c-b2c7-12d2a9e00d60) (en enda HTML-fil, ~1600 rader) byggd som ett verktyg/spel för en vän som är ny i Malmö och ska lära sig cykla runt i staden. Den har redan bra kärnfunktioner (utforska-läge, cykla-läge med riktig ruttmotor, Seterra-stilat quiz, egna landmärken) men:

- Kartan är **schematisk** — 30 platser handplacerade på ungefärliga koordinater, inte geografiskt korrekt. Fungerar dåligt som faktiskt hjälpmedel för att lära sig cykla i den riktiga staden.
- Visuellt känns den som en prototyp, inte färdig.
- Den lever i Artifact-sandlådan: inget git, ingen versionshantering, och `<img>`-taggar med inbäddade rasterbilder blockeras helt av CSP (bekräftat via ett kvarglömt debugtest, `#cspTest`, som aldrig städades bort) — därför handritade SVG-ikoner istället för riktiga foton.

Fredrik beställde en total omgörning, "både funktionellt och visuellt", och gav fritt mandat att göra om från grunden.

## Beslut

1. **Total nystart** — bygger om från grunden, inte en renovering av artefaktens struktur.
2. **Verklig, geografiskt korrekt karta** (Leaflet + OpenStreetMap-tiles) istället för schematisk SVG — samma mönster som syskonprojektet `malmo-parkeringskarta`.
3. **Blir ett riktigt projekt**: eget git-repo (`malmokartan` under Fredriks GitHub), inte kvar som Artifact. Ingen CSP-sandlåda att krocka med.
4. **Riktiga foton**, inte illustrationer — en plats i taget, med platshållare tills riktiga foton finns.
5. **Bara svenska** — ingen flerspråkighet. (Tidigare planer på sv/en är avskrivna; vännen läser svenska.)
6. **Ruttmotor**: behåll den befintliga, redan välskrivna algoritmen (Dijkstra + Yens k-kortaste-vägar för alternativa rutter) över en handkurerad graf av "de bra cykelstråken" — men flytta noderna till riktiga lat/lon-koordinater och baka in riktig väggeometri per sträcka via Overpass API (öppen OSM-data, inget konto/nyckel behövs), som ett engångs-datafördberedelsesteg. Ingen extern routing-tjänst vid körning — se "Rutter" nedan.

## Visuell identitet

Vald efter två rundor mockuper i webbläsarcompanion (se `.superpowers/brainstorm/` historik, inte incheckad). Riktning: **ren, fotodriven reseapp** — inget illustrativt, inget dekorativt; systemtypsnitt, minimalt UI-brus, fotot gör jobbet. Mörk botten, i samma paletfamilj som `malmo-parkeringskarta` och `uteservering-sol` så portföljen känns som en helhet.

```
--bg:        #171B1A   (mörk skiffer, botten)
--panel:     #212826   (kort/ytor)
--ink:       #EDE8DE   (text)
--ink-soft:  #B4ADA1   (sekundär text)
--accent:    #3FC2D1   (turkos — knappar, aktiv flik, länkar)
--accent-ink:#06262B   (text ovanpå accent-ytor)
```

Typografi: systemens sans-serif-stack (`-apple-system, 'Segoe UI', sans-serif`) rakt igenom — ingen display-serif, ingen monospace-etikettstil som i artefakten. Foton i 4:3 eller 3:2, rundade hörn, inga ramar/dekorationer runt dem. Ljust tema (`prefers-color-scheme: light` / `data-theme="light"`) speglar samma paletter i ljus version, konsekvent med hur de andra projekten hanterar tema.

## Teknik & repo

- Vanilla JS + [Leaflet](https://leafletjs.com/) + OSM-tiles. Ingen build-process, inget ramverk — matchar `malmo-parkeringskarta` och håller portföljen enhetlig.
- Nytt repo: `malmokartan`, publikt på Fredriks GitHub, döpt efter artefaktens etablerade namn.
- Drift: GitHub Pages (gratis, inga hemligheter/backend att hantera).

### Filstruktur

```
index.html       — struktur, stilar, appens logik (enfils-stil som syskonprojekten)
places.json       — 30 platser: id, namn, lat, lon, kategori, fakta-text, foto-referens
routes.json       — grafens kanter: from/to, stråk-namn, riktig väggeometri (polyline)
photos/           — en bild per plats; platshållarbild tills riktiga foton finns
tools/prep-routes.mjs — engångsskript: hämtar väggeometri från Overpass, skriver routes.json
test.mjs          — Node-testskript för routing-logiken (se Test)
```

## Datamodell

**Plats** (`places.json`, ersätter dagens `PLACES`-array i artefakten — 30 poster bevaras, samma fakta-texter återanvänds där de fortfarande stämmer):

```json
{
  "id": "ribban",
  "name": "Ribersborgsstranden",
  "lat": 55.6047,
  "lon": 12.9080,
  "category": "bad",
  "fact": "\"Ribban\" — långgrund stadsstrand med breda gräsytor, grillplatser och flera bryggor.",
  "photo": "ribban.jpg"
}
```

`nav`-fältet (vägbeskrivning i text) från artefakten tas bort — på en riktig karta ser man var platsen ligger, texten blir överflödig och en underhållsbörda.

**Kant/stråk** (`routes.json`, ersätter dagens `EDGES`-array):

```json
{
  "from": "ribban", "to": "kallbadhuset",
  "via": "längs Ribersborgsstigen",
  "geometry": [[55.6047,12.9080], [55.6041,12.9095], ...]
}
```

`geometry` hämtas en gång via `tools/prep-routes.mjs` mot Overpass API för den gata/stig som stråket följer, och checkas in — ingen live-hämtning vid körning.

## Lägen

Samma tre lägen som idag, ombyggda för riktig karta:

1. **Utforska** — klicka en markör → kort med foto + fakta, ingen separat "nav"-text (kartan visar redan var det är).
2. **Cykla** — välj från/till (dropdown, eller klicka kartan: första klick = start, andra = mål) → ritar rutten längs riktig väggeometri, med alternativa vägar där de finns (samma k-kortaste-vägar-motor som idag, oförändrad logik) och en etapplista med riktiga gatunamn.
3. **Quiz** — Seterra-stil: "tryck där X ligger", tolerans i meter från rätt punkt (haversine, samma mönster som redan finns i `malmo-parkeringskarta`), hjärtan/poäng som idag.
4. **Egna landmärken** — oförändrad funktion: lägg till egen pin genom att klicka kartan, sparas i `localStorage`, ingår i quizet.

## Test & felhantering

- `test.mjs`: Node-testskript (ingen DOM/browser krävs) som verifierar den rena logiken — kortaste väg, k-kortaste-vägar-urvalet (`meaningfulRoutes`), avståndsberäkning (haversine-toleransen i quizet). Samma vana som `40/40 tests`-mönstret i Fredriks andra projekt.
- Saknad/trasig fotofil → visar platshållarbild istället för trasig bild-ikon (CSS `onerror`-fallback).
- `localStorage`-läsning av egna landmärken behåller befintliga try/catch-skydd.
- Ingen live extern nätverksberoende utöver kartplattorna själva (OSM-tiles) — routingdata är förberäknad och incheckad.

## Utanför scope (uttryckligen avskrivet eller uppskjutet)

- Flerspråkighet (sv/en) — avskrivet, bara svenska.
- Extern routing-API (t.ex. OpenRouteService) för turn-by-turn — uppskjutet, kräver kontosignup jag inte kan göra åt Fredrik; nuvarande grafbaserade lösning räcker.
- Riktiga foton — platshållare nu, Fredrik/vännen fyller i filerna i `photos/` senare utan kodändring.
