# Malmökartan

En karta för att lära sig hitta och cykla runt i Malmö — byggd åt en vän som är
ny i stan. Klicka runt i "Utforska" för fakta om 30 platser, planera en
cykeltur i "Cykla", eller testa dig själv i "Quiz".

Ingen build-process — ren HTML/CSS/JS + [Leaflet](https://leafletjs.com/) och
OpenStreetMap-tiles.

## Köra lokalt

```bash
npx --yes serve .
```

## Testa

```bash
node --test test.mjs
```

## Lägga till riktiga foton

Lägg en bild per plats i `photos/`, döpt efter `photo`-fältet i `places.json`
(t.ex. `ribban.jpg`). Se `photos/README.md`.

## Data-förberedelse (engångskörningar, redan gjorda — kör bara igen vid behov)

```bash
node tools/geocode-places.mjs   # places.json
node tools/prep-routes.mjs      # routes.json
```
