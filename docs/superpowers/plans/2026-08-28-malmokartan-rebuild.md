# Malmökartan Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild "Malmökartan" from a schematic Claude Artifact into a real, geographically-accurate, git-tracked web app that helps a friend learn to cycle around real Malmö.

**Architecture:** Vanilla JS + Leaflet + OSM tiles, no build step, no framework. Pure routing/quiz logic lives in a single dependency-free ES module (`routing.mjs`) shared between the browser (via `<script type="module">`) and Node's built-in test runner — so the algorithmic core is unit-tested without a DOM. Content (places, route geometry) is static JSON, checked in, with route geometry baked in once offline via the Overpass API rather than fetched live.

**Tech Stack:** Leaflet 1.9.4 (CDN), OpenStreetMap tiles, Nominatim (geocoding, one-time data prep), Overpass API (route geometry, one-time data prep), Node's built-in `node:test`/`node:assert` (no devDependencies), GitHub Pages (hosting).

**Spec:** [docs/superpowers/specs/2026-08-28-malmokartan-rebuild-design.md](../specs/2026-08-28-malmokartan-rebuild-design.md)

## Global Constraints

- No build process, no framework, no npm dependencies — matches sibling projects (`malmo-parkeringskarta`, `uteservering-sol`). Node is used only to run one-time data-prep scripts and tests, never to build the shipped app.
- Bara svenska — no i18n, no English strings anywhere.
- Visual tokens (exact, from the approved mockup — do not deviate):
  `--bg:#171B1A; --panel:#212826; --ink:#EDE8DE; --ink-soft:#B4ADA1; --accent:#3FC2D1; --accent-ink:#06262B;`
  Typography: system sans-serif stack only (`-apple-system,'Segoe UI',sans-serif`) — no serif, no monospace labels, no illustration/decoration. Photos do the visual work.
- All 30 places from the original artifact are carried over (same `id`s and `fact` text where still accurate) — see Task 2 for the full source list.
- No external routing API, no API keys, no account signups (Fredrik cannot create accounts on the user's behalf) — Overpass and Nominatim are keyless.
- Every `fetch` to Nominatim/Overpass sets a descriptive `User-Agent` per their usage policy, and paces requests (≥1.1s apart) to stay within fair-use limits.

---

## Task 1: Pure routing & quiz-tolerance module

**Files:**
- Create: `routing.mjs`
- Create: `test.mjs`

**Interfaces:**
- Produces (used by Tasks 3, 4, 5, 6, 7): `haversineMeters(lat1,lon1,lat2,lon2) → meters:number`, `buildGraph(places, edges, detour=1.15) → graph` (graph is `{[placeId]: [{to, via, meters, geometry?}]}`), `shortestPath(graph, from, to, banEdges?, banNodes?) → {legs, meters} | null`, `kShortest(graph, from, to, K) → route[]`, `meaningfulRoutes(routes) → route[]`, `pathNodes(route) → placeId[]`, `routeLabel(route, refRoute, byId) → string`, `stripPrep(via) → string`, `isWithinTolerance(clickLat, clickLon, targetLat, targetLon, radiusMeters) → boolean`.

- [ ] **Step 1: Write the failing tests**

Create `test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineMeters, buildGraph, shortestPath, kShortest, meaningfulRoutes, isWithinTolerance
} from './routing.mjs';

// Fem platser: en kort väg a->b->d, och en tydligt längre omväg a->c->e->d
// (helt separata noder/kanter, inte parallella kanter mellan samma två
// platser — parallella kanter med samma from/to kollapsar till samma
// nodsekvens i Yens algoritm och går aldrig att skilja åt som "olika
// rutter", oavsett hur långa de är).
const places = [
  { id: 'a', lat: 55.600, lon: 13.000 },
  { id: 'b', lat: 55.605, lon: 13.000 },
  { id: 'd', lat: 55.610, lon: 13.000 },
  { id: 'c', lat: 55.600, lon: 13.030 },
  { id: 'e', lat: 55.610, lon: 13.030 }
];
const edges = [
  { from: 'a', to: 'b', via: 'längs korta vägen' },
  { from: 'b', to: 'd', via: 'längs korta vägen' },
  { from: 'a', to: 'c', via: 'genom omvägen' },
  { from: 'c', to: 'e', via: 'genom omvägen' },
  { from: 'e', to: 'd', via: 'genom omvägen' }
];
// Kort väg (a-b-d) ≈ 1.11 km fågelvägen * 1.15 ≈ 1.28 km.
// Omväg (a-c-e-d) ≈ 4.87 km fågelvägen * 1.15 ≈ 5.60 km — ca 4.4x längre,
// alltså tydligt över 1.9x-gränsen och robust oavsett flyttal-avrundning.

test('haversineMeters ger rimligt avstånd mellan Malmö C och Triangeln (~1.9km)', () => {
  const d = haversineMeters(55.6094, 13.0007, 55.5945, 13.0004);
  assert.ok(d > 1500 && d < 2300, `förväntade ~1.9km, fick ${Math.round(d)}m`);
});

test('shortestPath hittar den kortaste av två vägar', () => {
  const graph = buildGraph(places, edges);
  const route = shortestPath(graph, 'a', 'd');
  assert.ok(route);
  const nodes = [route.legs[0].from, ...route.legs.map(l => l.to)];
  assert.deepEqual(nodes, ['a', 'b', 'd']);
});

test('shortestPath returnerar null om ingen väg finns', () => {
  const graph = buildGraph(places, edges);
  assert.equal(shortestPath(graph, 'a', 'z'), null);
});

test('kShortest hittar båda rimliga vägarna a->d, kortast först', () => {
  const graph = buildGraph(places, edges);
  const routes = kShortest(graph, 'a', 'd', 3);
  assert.ok(routes.length >= 2, `förväntade minst 2 vägar, fick ${routes.length}`);
  assert.ok(routes[0].meters <= routes[1].meters);
});

test('meaningfulRoutes filtrerar bort vägar mer än ~2x längre än den kortaste', () => {
  const graph = buildGraph(places, edges);
  const routes = kShortest(graph, 'a', 'd', 5).sort((x, y) => x.meters - y.meters);
  assert.ok(routes.length >= 2, `behöver minst 2 vägar för att testa filtreringen, fick ${routes.length}`);
  const filtered = meaningfulRoutes(routes);
  assert.equal(filtered.length, 1, 'den ~4x längre omvägen ska ha filtrerats bort, bara den korta vägen kvar');
});

test('isWithinTolerance accepterar klick nära rätt punkt, avvisar långt bort', () => {
  const target = { lat: 55.6047, lon: 12.9080 };
  assert.equal(isWithinTolerance(55.6048, 12.9081, target.lat, target.lon, 150), true);
  assert.equal(isWithinTolerance(55.62, 13.05, target.lat, target.lon, 150), false);
});

test('buildGraph räknar meterlängd längs given geometri, inte fågelvägen', () => {
  const zigzag = [{
    from: 'a', to: 'b', via: 'test',
    geometry: [[55.60, 13.00], [55.605, 13.00], [55.60, 13.005], [55.61, 13.00]]
  }];
  const graph = buildGraph(places, zigzag);
  const straight = haversineMeters(55.60, 13.00, 55.61, 13.00);
  assert.ok(graph.a[0].meters > straight, 'zigzag-geometrin ska vara längre än fågelvägen');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test.mjs`
Expected: FAIL — `routing.mjs` does not exist yet (`Cannot find module`).

- [ ] **Step 3: Implement `routing.mjs`**

Create `routing.mjs`:

```js
// Ren, DOM-fri routing- och avståndslogik. Importeras både av app.js (browser,
// <script type="module">) och test.mjs (Node) — en enda sanning för algoritmen.

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isWithinTolerance(clickLat, clickLon, targetLat, targetLon, radiusMeters) {
  return haversineMeters(clickLat, clickLon, targetLat, targetLon) <= radiusMeters;
}

function polylineMeters(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return total;
}

// edges: [{from, to, via, geometry?: [[lat,lon], ...]}]. Saknas geometri
// (t.ex. för en kant Overpass inte kunde matcha) faller vi tillbaka på
// fågelvägen * detour — gator går sällan helt rakt.
export function buildGraph(places, edges, detour = 1.15) {
  const byId = Object.fromEntries(places.map(p => [p.id, p]));
  const graph = {};
  for (const edge of edges) {
    const from = byId[edge.from], to = byId[edge.to];
    if (!from || !to) continue;
    const meters = edge.geometry && edge.geometry.length > 1
      ? polylineMeters(edge.geometry)
      : haversineMeters(from.lat, from.lon, to.lat, to.lon) * detour;
    (graph[edge.from] ??= []).push({ to: edge.to, via: edge.via, meters, geometry: edge.geometry });
    (graph[edge.to] ??= []).push({
      to: edge.from, via: edge.via, meters,
      geometry: edge.geometry ? [...edge.geometry].reverse() : undefined
    });
  }
  return graph;
}

export function shortestPath(graph, from, to, banEdges = {}, banNodes = {}) {
  if (from === to) return null;
  const dist = {}, prev = {}, seen = {};
  const queue = [from];
  dist[from] = 0;
  while (queue.length) {
    queue.sort((a, b) => dist[a] - dist[b]);
    const cur = queue.shift();
    if (seen[cur]) continue;
    seen[cur] = true;
    if (cur === to) break;
    for (const edge of graph[cur] || []) {
      if (banNodes[edge.to]) continue;
      if (banEdges[cur + '|' + edge.to]) continue;
      const nd = dist[cur] + edge.meters;
      if (dist[edge.to] === undefined || nd < dist[edge.to]) {
        dist[edge.to] = nd;
        prev[edge.to] = { from: cur, via: edge.via, meters: edge.meters, geometry: edge.geometry };
        queue.push(edge.to);
      }
    }
  }
  if (dist[to] === undefined) return null;
  const legs = [];
  let node = to;
  while (node !== from) {
    const p = prev[node];
    legs.unshift({ from: p.from, to: node, via: p.via, meters: p.meters, geometry: p.geometry });
    node = p.from;
  }
  return { legs, meters: dist[to] };
}

export function pathNodes(route) {
  return [route.legs[0].from, ...route.legs.map(l => l.to)];
}

function sameHead(a, b) {
  if (a.length < b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Yens algoritm: K kortaste vägarna utan cirklar, så man ser att det ofta
// finns fler än ett rimligt sätt att cykla mellan två platser.
export function kShortest(graph, from, to, K) {
  const first = shortestPath(graph, from, to);
  if (!first) return [];
  const A = [first];
  let B = [];
  let guard = 0;
  while (A.length < K && guard++ < 40) {
    const prevRoute = A[A.length - 1];
    const prevNodes = pathNodes(prevRoute);
    for (let i = 0; i < prevNodes.length - 1; i++) {
      const rootNodes = prevNodes.slice(0, i + 1);
      const banEdges = {}, banNodes = {};
      for (const p of [...A, ...B]) {
        const pn = pathNodes(p);
        if (pn.length > i + 1 && sameHead(pn, rootNodes)) {
          banEdges[pn[i] + '|' + pn[i + 1]] = true;
          banEdges[pn[i + 1] + '|' + pn[i]] = true;
        }
      }
      for (const n of rootNodes.slice(0, i)) banNodes[n] = true;
      const spur = shortestPath(graph, prevNodes[i], to, banEdges, banNodes);
      if (!spur) continue;
      const rootLegs = prevRoute.legs.slice(0, i);
      const cand = {
        legs: [...rootLegs, ...spur.legs],
        meters: rootLegs.reduce((s, l) => s + l.meters, 0) + spur.meters
      };
      const key = pathNodes(cand).join('>');
      const known = [...A, ...B].some(p => pathNodes(p).join('>') === key);
      if (!known) B.push(cand);
    }
    if (!B.length) break;
    B.sort((a, b) => a.meters - b.meters);
    A.push(B.shift());
  }
  return A;
}

// Behåll bara alternativ som är rimligt korta och tydligt olika — annars
// fylls listan med vägar som skiljer sig med ett enda kvarter.
export function meaningfulRoutes(list) {
  const out = [];
  for (const r of list) {
    if (!out.length) { out.push(r); continue; }
    if (r.meters > out[0].meters * 1.9) continue;
    const rn = pathNodes(r);
    const nearDuplicate = out.some(o => {
      const on = pathNodes(o);
      const diff = rn.filter(n => !on.includes(n)).length + on.filter(n => !rn.includes(n)).length;
      return diff < 2;
    });
    if (!nearDuplicate) out.push(r);
  }
  return out;
}

export function stripPrep(via) {
  return via.replace(/^(längs|genom|förbi|över|upp för)\s+/, '');
}

// Namnger ett alternativ efter det som skiljer det från referensvägen —
// annars får flera alternativ samma etikett och valet blir obegripligt.
export function routeLabel(route, refRoute, byId) {
  if (refRoute && refRoute !== route) {
    const refNodes = pathNodes(refRoute);
    const onlyHere = pathNodes(route).filter(n => !refNodes.includes(n));
    if (onlyHere.length) return byId[onlyHere[0]].name;
    const refVias = new Set(refRoute.legs.map(l => l.via));
    const uniq = route.legs.filter(l => !refVias.has(l.via)).sort((a, b) => b.meters - a.meters)[0];
    if (uniq) return stripPrep(uniq.via);
  }
  const longest = route.legs.reduce((a, b) => (b.meters > a.meters ? b : a), route.legs[0]);
  return stripPrep(longest.via);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test.mjs`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add routing.mjs test.mjs
git commit -m "Add pure routing/quiz-tolerance module with tests"
```

---

## Task 2: Real place data (`places.json`)

**Files:**
- Create: `tools/geocode-places.mjs`
- Create: `places.json` (generated by the script, then checked in)
- Modify: `test.mjs` (append validation test)

**Interfaces:**
- Produces (used by Tasks 3–7): `places.json` — array of `{id, name, lat, lon, category, fact, photo}`. `category` is one of `bad | hamn | park | centrum | oster` (matches the artifact's `CATS`; `egen` is reserved for user-added landmarks and never appears in this file).

- [ ] **Step 1: Write `tools/geocode-places.mjs`**

This is a one-time data-prep script (not part of the shipped app). It geocodes the 30 places from the original artifact via Nominatim (same keyless service already used in `malmo-parkeringskarta`) and writes `places.json`.

Create `tools/geocode-places.mjs`:

```js
import { writeFileSync } from 'node:fs';

// Källa: platslistan från den ursprungliga Malmökartan-artefakten
// (PLACES-arrayen), med samma id/namn/kategori/fact-text. `query` är vad
// som skickas till Nominatim — oftast namnet + ", Malmö", men för tvetydiga
// namn (t.ex. "Kirseberg" som är både stadsdel och plats) mer specifikt.
const SOURCE = [
  { id: 'djuphavsbadet', name: 'Djuphavsbadet', category: 'bad', query: 'Djuphavsbadet, Malmö',
    fact: 'Badplats längst ut vid Scaniaparken — djupt vatten direkt från kajkanten och utsikt över sundet.' },
  { id: 'torso', name: 'Turning Torso', category: 'hamn', query: 'Turning Torso, Malmö',
    fact: 'Nordens högsta byggnad, 190 m, som vrider sig 90 grader på vägen upp.' },
  { id: 'vastrahamnen', name: 'Västra hamnen', category: 'hamn', query: 'Västra Hamnen, Malmö',
    fact: 'Nybyggd stadsdel på det gamla varvsområdet: kajstråk, Sundspromenaden och havsbad.' },
  { id: 'canteen', name: 'Canteen', category: 'hamn', query: 'Canteen restaurang Västra Hamnen, Malmö',
    fact: 'Omtyckt restaurang i Västra hamnen — lunch och middag, nära vattnet.' },
  { id: 'dockan', name: 'Dockan', category: 'hamn', query: 'Dockan, Malmö',
    fact: 'Marina och kontorskvarter runt den gamla torrdockan från varvstiden.' },
  { id: 'kockum', name: 'Kockum Fritid', category: 'hamn', query: 'Kockum Fritid, Malmö',
    fact: 'Stor idrottsanläggning med simhall, ishall och sporthallar i gamla varvsområdet.' },
  { id: 'centralen', name: 'Centralen', category: 'centrum', query: 'Malmö Centralstation',
    fact: 'Malmö C — tåg mot Köpenhamn, Lund och resten av landet. Härifrån utgår det mesta.' },
  { id: 'slottstradgarden', name: 'Slottsträdgården', category: 'park', query: 'Slottsträdgården, Malmö',
    fact: 'Ekologisk visningsträdgård med kafé, odlingar och en väderkvarn.' },
  { id: 'slottsparken', name: 'Slottsparken', category: 'park', query: 'Slottsparken, Malmö',
    fact: 'Engelsk landskapspark runt Malmöhus slott, med dammar och stadsbiblioteket i kanten.' },
  { id: 'kungsparken', name: 'Kungsparken', category: 'park', query: 'Kungsparken, Malmö',
    fact: 'Malmös äldsta park från 1872 — kanalen, gamla jätteträd och Casino Malmö i mitten.' },
  { id: 'rorsjoparken', name: 'Rörsjöparken', category: 'park', query: 'Rörsjöparken, Malmö',
    fact: 'Lugn kvarterspark med lekplats och stora almar mitt i Rörsjöstaden.' },
  { id: 'triangeln', name: 'Triangeln', category: 'centrum', query: 'Triangeln, Malmö',
    fact: 'Köpcentrum, kyrka och en tågstation under jord — tåget mot Köpenhamn stannar här.' },
  { id: 'stknut', name: 'S:t Knut', category: 'centrum', query: 'Sankt Knuts torg, Malmö',
    fact: 'S:t Knuts torg — litet torg på Amiralsgatan med kaféer och kvarterskänsla.' },
  { id: 'folketspark', name: 'Folkets park', category: 'park', query: 'Folkets Park, Malmö',
    fact: 'Sveriges äldsta folkpark: Far i hatten, minigolf, dansbanor, terrarium och loppis.' },
  { id: 'mollan', name: 'Möllevångstorget', category: 'centrum', query: 'Möllevångstorget, Malmö',
    fact: '"Möllan" — grönsaksmarknad på förmiddagen, krogar och folkliv på kvällen.' },
  { id: 'sodervarn', name: 'Södervärn', category: 'centrum', query: 'Södervärn, Malmö',
    fact: 'Malmös stora busshubb — nästan alla stadsbussar passerar här. Sjukhusområdet ligger intill.' },
  { id: 'vattentornet', name: 'Södervärns vattentorn', category: 'centrum', query: 'Vattentornet Södervärn, Malmö',
    fact: 'Vattentornet från 1916 som ser ut som en jättesvamp. Syns långt och är ett bra riktmärke söderut.' },
  { id: 'karlskronaplan', name: 'Karlskronaplan', category: 'centrum', query: 'Karlskronaplan, Malmö',
    fact: 'Torg i Sofielund med torghandel och plats där flera gator strålar samman.' },
  { id: 'pildammsparken', name: 'Pildammsparken', category: 'park', query: 'Pildammsparken, Malmö',
    fact: 'Malmös största park: dammarna, Tallriken och Amfiteatern. Anlagd kring 1914 års utställning.' },
  { id: 'stadion', name: 'Malmö stadion', category: 'centrum', query: 'Malmö Stadion',
    fact: 'Gamla arenan från fotbolls-VM 1958. Nya Eleda Stadion, där MFF spelar, ligger vägg i vägg.' },
  { id: 'varnhem', name: 'Värnhem', category: 'oster', query: 'Värnhemstorget, Malmö',
    fact: 'Värnhemstorget — viktig bytespunkt för bussar i nordöstra innerstaden, med Entré-huset intill.' },
  { id: 'beijers', name: 'Beijers park', category: 'park', query: 'Beijers Park, Malmö',
    fact: 'Kuperad park i Kirseberg med utsikt över stan, hundrastgård och plaskdamm.' },
  { id: 'kirseberg', name: 'Kirseberg', category: 'oster', query: 'Kirsebergstorget, Malmö',
    fact: '"Backarna" — gammal stadsdel med små hus, eget torg och gott om verkstads- och kulturliv.' },
  { id: 'nobeltorget', name: 'Nobeltorget', category: 'oster', query: 'Nobeltorget, Malmö',
    fact: 'Torg där Nobelvägen och Amiralsgatan möts, i östra kanten av innerstaden.' },
  { id: 'kallbadhuset', name: 'Ribersborgs kallbadhus', category: 'bad', query: 'Ribersborgs Kallbadhus, Malmö',
    fact: 'Kallbadhus från 1898 ute på bryggan — bastu och havsbad året runt, med dam- och herravdelning.' },
  { id: 'ribban', name: 'Ribersborgsstranden', category: 'bad', query: 'Ribersborgsstranden, Malmö',
    fact: '"Ribban" — långgrund stadsstrand med breda gräsytor, grillplatser och flera bryggor.' },
  { id: 'tbryggan', name: 'T-bryggan', category: 'bad', query: 'T-bryggan Ribersborg, Malmö',
    fact: 'Badbrygga formad som ett T rakt ut i Öresund — klassiskt ställe för morgondopp.' },
  { id: 'handikappbadet', name: 'Handikappbadet', category: 'bad', query: 'Ribersborgs handikappbad, Malmö',
    fact: 'Ribersborgs handikappbad — tillgänglig badbrygga med ramp, lift och omklädningsrum.' },
  { id: 'limhamn', name: 'Limhamn', category: 'bad', query: 'Limhamns torg, Malmö',
    fact: 'Gammalt fiske- och kalkbrottssamhälle, numera del av Malmö. Hamnen, torget och det stora kalkbrottet.' },
  { id: 'sibbarp', name: 'Sibbarp', category: 'bad', query: 'Sibbarp, Malmö',
    fact: 'Badplats och grillområde med bryggor, rakt under Öresundsbrons fäste.' }
];

// Malmö + marginal — samma viewbox som redan används i malmo-parkeringskarta.
const VIEWBOX = '12.80,55.70,13.20,55.45';
const USER_AGENT = 'malmokartan-dataprep/1.0 (privat projekt, se github.com/FredAspBA/malmokartan)';

async function geocode(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=se&bounded=1&viewbox=' +
    encodeURIComponent(VIEWBOX) + '&q=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim svarade ${res.status} för "${query}"`);
  const results = await res.json();
  if (!results.length) return null;
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
}

const places = [];
const failed = [];
for (const p of SOURCE) {
  process.stdout.write(`${p.id} (${p.query})... `);
  const hit = await geocode(p.query);
  if (!hit) {
    console.log('INGEN TRÄFF');
    failed.push(p.id);
    continue;
  }
  console.log(`${hit.lat.toFixed(5)}, ${hit.lon.toFixed(5)}`);
  places.push({
    id: p.id, name: p.name, lat: hit.lat, lon: hit.lon,
    category: p.category, fact: p.fact, photo: `${p.id}.jpg`
  });
  await new Promise(r => setTimeout(r, 1100)); // Nominatim fair-use: max 1 req/s
}

if (failed.length) {
  console.error(`\n${failed.length} plats(er) fick ingen träff och saknas i places.json: ${failed.join(', ')}`);
  console.error('Lägg till dem manuellt (slå upp koordinaterna för hand) innan du går vidare.');
}

writeFileSync(new URL('../places.json', import.meta.url), JSON.stringify(places, null, 2));
console.log(`\nSkrev places.json med ${places.length} platser.`);
```

- [ ] **Step 2: Run the script**

Run: `node tools/geocode-places.mjs`
Expected: Prints one line per place with resolved coordinates, writes `places.json` with 30 entries. If any place prints "INGEN TRÄFF", look up its coordinates manually (e.g. openstreetmap.org search) and add the entry to `places.json` by hand before continuing — do not proceed with fewer than 30 places.

- [ ] **Step 3: Write the validation test**

Append to `test.mjs`:

```js
import { readFileSync } from 'node:fs';

test('places.json innehåller 30 unika platser inom Malmös bounding box', () => {
  const places = JSON.parse(readFileSync(new URL('./places.json', import.meta.url)));
  assert.equal(places.length, 30, `förväntade 30 platser, hittade ${places.length}`);
  const ids = new Set(places.map(p => p.id));
  assert.equal(ids.size, places.length, 'id:n måste vara unika');
  const CATS = new Set(['bad', 'hamn', 'park', 'centrum', 'oster']);
  for (const p of places) {
    assert.ok(p.lat > 55.55 && p.lat < 55.65, `${p.id}: lat ${p.lat} utanför Malmö`);
    assert.ok(p.lon > 12.85 && p.lon < 13.05, `${p.id}: lon ${p.lon} utanför Malmö`);
    assert.ok(CATS.has(p.category), `${p.id}: okänd kategori "${p.category}"`);
    assert.ok(p.fact && p.fact.length > 10, `${p.id}: saknar fact-text`);
    assert.ok(p.photo, `${p.id}: saknar photo-fält`);
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test.mjs`
Expected: All previous tests plus this new one PASS (8 total).

- [ ] **Step 5: Commit**

```bash
git add tools/geocode-places.mjs places.json test.mjs
git commit -m "Add real geocoded place data (places.json)"
```

---

## Task 3: Real route geometry (`routes.json`)

**Files:**
- Create: `routes-src.json`
- Create: `tools/prep-routes.mjs`
- Create: `routes.json` (generated by the script, then checked in)
- Modify: `test.mjs` (append validation test)

**Interfaces:**
- Consumes: `places.json` (Task 2), `haversineMeters` from `routing.mjs` (Task 1).
- Produces (used by Tasks 5, 6): `routes.json` — array of `{from, to, via, geometry: [[lat,lon], ...]}`, `from`/`to` are place ids from `places.json`.

- [ ] **Step 1: Write `routes-src.json`**

The kant-lista (stråk) från den ursprungliga artefaktens `EDGES`-array, oförändrad (samma platser, samma stråknamn) — 39 kanter, inte 38 (räknat i steg 1 nedan; en tidigare version av den här texten sa 38 av misstag):

```json
[
  ["sibbarp", "limhamn", "längs kuststråket"],
  ["limhamn", "handikappbadet", "längs Limhamnsvägen"],
  ["handikappbadet", "tbryggan", "längs strandstråket"],
  ["tbryggan", "ribban", "längs strandstråket"],
  ["ribban", "kallbadhuset", "längs Ribersborgsstigen"],
  ["kallbadhuset", "torso", "längs Sundspromenaden"],
  ["ribban", "slottsparken", "längs Regementsgatan"],
  ["torso", "djuphavsbadet", "genom Scaniaparken"],
  ["torso", "vastrahamnen", "längs Sundspromenaden"],
  ["vastrahamnen", "canteen", "längs Stora Varvsgatan"],
  ["canteen", "dockan", "förbi Dockplatsen"],
  ["dockan", "kockum", "längs Västra Varvsgatan"],
  ["kockum", "centralen", "över Universitetsholmen"],
  ["centralen", "kungsparken", "längs kanalen"],
  ["kungsparken", "slottsparken", "längs kanalen"],
  ["slottsparken", "slottstradgarden", "genom Slottsparken"],
  ["centralen", "slottstradgarden", "längs Citadellsvägen"],
  ["centralen", "rorsjoparken", "genom Rörsjöstaden"],
  ["rorsjoparken", "varnhem", "längs Östra Förstadsgatan"],
  ["varnhem", "beijers", "längs Sallerupsvägen"],
  ["beijers", "kirseberg", "upp för Kirsebergsbacken"],
  ["varnhem", "kirseberg", "längs Lundavägen"],
  ["varnhem", "nobeltorget", "längs Nobelvägen"],
  ["centralen", "triangeln", "längs Södra Förstadsgatan"],
  ["kungsparken", "triangeln", "längs Rådmansgatan"],
  ["triangeln", "stknut", "längs Amiralsgatan"],
  ["stknut", "folketspark", "längs Amiralsgatan"],
  ["folketspark", "mollan", "genom kvarteren vid Möllan"],
  ["folketspark", "nobeltorget", "längs Nobelvägen"],
  ["mollan", "triangeln", "längs Bergsgatan"],
  ["mollan", "sodervarn", "längs Södra Förstadsgatan"],
  ["sodervarn", "triangeln", "längs Södra Förstadsgatan"],
  ["sodervarn", "vattentornet", "över Södervärns torg"],
  ["sodervarn", "karlskronaplan", "längs Ystadvägen"],
  ["karlskronaplan", "nobeltorget", "längs Lantmannagatan"],
  ["triangeln", "pildammsparken", "längs Pildammsvägen"],
  ["pildammsparken", "stadion", "längs Stadiongatan"],
  ["pildammsparken", "sodervarn", "längs Pildammsvägen"],
  ["slottsparken", "pildammsparken", "längs Fersens väg"]
]
```

Convert each `[from, to, via]` triple to an object `{from, to, via}` when writing the file (the JSON above uses the compact 3-tuple form for readability while drafting; `tools/prep-routes.mjs` in the next step reads the object form — write `routes-src.json` as an array of `{"from": "...", "to": "...", "via": "..."}` objects).

- [ ] **Step 2: Write `tools/prep-routes.mjs`**

OSM splits an ordinary street into many short "way" segments — one per block, split at every intersection (a single street can be 20-70 separate ways). Matching against one way at a time can never span the distance between two places on a long street, so this script fetches every way segment with the target name inside a bounding box around both places, stitches them into a small node-level graph (segments that share an OpenStreetMap node id are connected — that's how consecutive blocks of the same street join up), and reuses `routing.mjs`'s own `shortestPath` to walk from the point on that graph nearest `from` to the point nearest `to`. A handful of `via` values are area/corridor descriptions rather than real street names (e.g. "kuststråket", "Universitetsholmen") — those correctly and permanently fail to match anything and fall back to a straight line; that's expected, not a bug to chase.

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { haversineMeters, shortestPath, pathNodes } from '../routing.mjs';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'malmokartan-dataprep/1.0 (privat projekt, se github.com/FredAspBA/malmokartan)';

const places = JSON.parse(readFileSync(new URL('../places.json', import.meta.url)));
const edgesSrc = JSON.parse(readFileSync(new URL('../routes-src.json', import.meta.url)));
const byId = Object.fromEntries(places.map(p => [p.id, p]));

function stripPrep(via) {
  return via.replace(/^(längs|genom|förbi|över|upp för)\s+/, '');
}

function polylineMeters(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return total;
}

// Bounding box (syd,väst,nord,öst) som täcker from/to med marginal — så att
// en gata som svänger mellan de två platserna ändå fångas, men inte så
// stor att en helt annan gata med samma namn på andra sidan stan följer med.
// Marginalen är generös (platser sitter sällan bokstavligen på den gata som
// beskriver vägen dit — Triangeln ligger t.ex. drygt 700 m från Amiralsgatan
// men "längs Amiralsgatan" är ändå rätt beskrivning av cykelturen).
function bboxFor(from, to) {
  const straightM = haversineMeters(from.lat, from.lon, to.lat, to.lon);
  const padM = Math.max(700, straightM * 0.6);
  const midLatRad = (from.lat + to.lat) / 2 * Math.PI / 180;
  const padLat = padM / 111000;
  const padLon = padM / (111000 * Math.cos(midLatRad));
  return [
    Math.min(from.lat, to.lat) - padLat, Math.min(from.lon, to.lon) - padLon,
    Math.max(from.lat, to.lat) + padLat, Math.max(from.lon, to.lon) + padLon
  ];
}

async function fetchWays(streetName, bbox) {
  const query = `[out:json][timeout:25];way["name"="${streetName}"](${bbox.join(',')});out geom;`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
    body: query
  });
  if (!res.ok) throw new Error(`Overpass svarade ${res.status}`);
  const data = await res.json();
  return data.elements.filter(el => el.type === 'way' && Array.isArray(el.geometry) && Array.isArray(el.nodes));
}

// En nod-graf av alla hämtade vägsegment. Nyckeln är OSM-nodens id, så
// segment som delar en korsning (samma nod-id) kopplas ihop automatiskt —
// det är precis det ett enda segment i taget inte kan göra.
function buildWayGraph(ways) {
  const graph = {};
  const pointOf = {};
  for (const way of ways) {
    const ids = way.nodes, geo = way.geometry;
    if (ids.length !== geo.length) continue;
    for (let i = 0; i < ids.length; i++) pointOf[ids[i]] = [geo[i].lat, geo[i].lon];
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1], b = ids[i];
      const d = haversineMeters(geo[i - 1].lat, geo[i - 1].lon, geo[i].lat, geo[i].lon);
      (graph[a] ??= []).push({ to: b, meters: d });
      (graph[b] ??= []).push({ to: a, meters: d });
    }
  }
  return { graph, pointOf };
}

function nearestNode(pointOf, lat, lon) {
  let best = null, bestDist = Infinity;
  for (const id in pointOf) {
    const [plat, plon] = pointOf[id];
    const d = haversineMeters(lat, lon, plat, plon);
    if (d < bestDist) { bestDist = d; best = id; }
  }
  return { id: best, dist: bestDist };
}

async function geometryForEdge(edge) {
  const from = byId[edge.from], to = byId[edge.to];
  if (!from || !to) throw new Error(`Okänd plats i kant ${edge.from}->${edge.to}`);
  const streetName = stripPrep(edge.via);
  const straight = [[from.lat, from.lon], [to.lat, to.lon]];
  const straightM = haversineMeters(from.lat, from.lon, to.lat, to.lon);

  let ways;
  try {
    ways = await fetchWays(streetName, bboxFor(from, to));
  } catch (err) {
    console.warn(`  ! Overpass-fel för ${edge.from}->${edge.to} (${streetName}): ${err.message} — rak linje`);
    return straight;
  }
  if (!ways.length) {
    console.warn(`  ! Ingen väg vid namn "${streetName}" hittades nära ${edge.from}->${edge.to} — rak linje`);
    return straight;
  }

  const { graph, pointOf } = buildWayGraph(ways);
  const fromNode = nearestNode(pointOf, from.lat, from.lon);
  const toNode = nearestNode(pointOf, to.lat, to.lon);
  // Ingen hård gräns här på hur långt bort noden ligger från platsen — en
  // plats sitter sällan exakt på den gata som beskriver vägen dit (se
  // kommentaren vid bboxFor). Söksökrutan är redan den geografiska filtret.
  const route = shortestPath(graph, fromNode.id, toNode.id);
  if (!route) {
    console.warn(`  ! "${streetName}"-segmenten hänger inte ihop mellan ${edge.from} och ${edge.to} (närmast: ${Math.round(fromNode.dist)}m/${Math.round(toNode.dist)}m) — rak linje`);
    return straight;
  }

  // Foga ihop den riktiga platskoordinaten i varje ände med gatans geometri
  // — annars slutar linjen mitt i en gata istället för vid markören.
  const streetPoints = pathNodes(route).map(id => pointOf[id]);
  const geometry = [[from.lat, from.lon], ...streetPoints, [to.lat, to.lon]];

  // Sundhetskontrollen mäts på den SLUTLIGA geometrin (gata + båda
  // anslutningsbitarna till platserna), inte bara på den ihopfogade gatan
  // för sig — annars kan en lång anslutningsbit dölja att totalen ändå blev
  // orimlig, trots att gatubiten i sig klarade gränsen.
  const totalM = polylineMeters(geometry);
  if (totalM > straightM * 3) {
    console.warn(`  ! Slutlig väg via "${streetName}" (inkl. anslutning till platserna) är ${Math.round(totalM)}m, mer än 3x de ${Math.round(straightM)}m fågelvägen — rak linje`);
    return straight;
  }

  return geometry;
}

const out = [];
for (const edge of edgesSrc) {
  process.stdout.write(`${edge.from} -> ${edge.to} (${edge.via})... `);
  const geometry = await geometryForEdge(edge);
  console.log(`${geometry.length} punkter`);
  out.push({ ...edge, geometry });
  await new Promise(r => setTimeout(r, 1100)); // Overpass fair-use: max ~1 req/s
}

writeFileSync(new URL('../routes.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`\nSkrev routes.json med ${out.length} kanter.`);
```

- [ ] **Step 3: Run the script**

Run: `node tools/prep-routes.mjs`
Expected: One line per edge (39 total), each ending in "N punkter" — either real, node-stitched street geometry (typically many points for a multi-block street) or a 2-point straight-line fallback with a warning printed above it explaining why (no matching way, endpoints too far from the matched street, segments didn't connect, or the stitched path was implausibly long). Writes `routes.json`. A handful of straight-line fallbacks is expected and fine — some `via` values are area/corridor descriptions rather than real street names (e.g. "kuststråket", "Universitetsholmen") and will always fall back; that's correct, not a bug. If a `via` that names a real, verifiable street still falls back, spot-check it against openstreetmap.org and adjust the wording in `routes-src.json` before re-running.

- [ ] **Step 4: Write the validation test**

Append to `test.mjs`:

```js
test('routes.json refererar bara riktiga platser och har giltig geometri', () => {
  const places = JSON.parse(readFileSync(new URL('./places.json', import.meta.url)));
  const routes = JSON.parse(readFileSync(new URL('./routes.json', import.meta.url)));
  const ids = new Set(places.map(p => p.id));
  assert.ok(routes.length >= 30, `förväntade minst 30 kanter, hittade ${routes.length}`);
  for (const r of routes) {
    assert.ok(ids.has(r.from), `okänd from-plats "${r.from}"`);
    assert.ok(ids.has(r.to), `okänd to-plats "${r.to}"`);
    assert.ok(Array.isArray(r.geometry) && r.geometry.length >= 2, `${r.from}->${r.to}: ogiltig geometri`);
  }
});

test('varje plats i places.json nås av minst en kant i routes.json', () => {
  const places = JSON.parse(readFileSync(new URL('./places.json', import.meta.url)));
  const routes = JSON.parse(readFileSync(new URL('./routes.json', import.meta.url)));
  const connected = new Set(routes.flatMap(r => [r.from, r.to]));
  const isolated = places.filter(p => !connected.has(p.id));
  assert.equal(isolated.length, 0, `Platser utan någon rutt: ${isolated.map(p => p.id).join(', ')}`);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test.mjs`
Expected: All previous tests plus these 2 new ones PASS (10 total).

- [ ] **Step 6: Commit**

```bash
git add routes-src.json tools/prep-routes.mjs routes.json test.mjs
git commit -m "Add real route geometry (routes.json) via Overpass"
```

---

## Task 4: App shell, map, and Utforska (explore) mode

**Files:**
- Create: `index.html`
- Create: `app.js`
- Create: `photos/placeholder.svg`
- Create: `photos/README.md`

**Interfaces:**
- Consumes: `places.json` (Task 2), `routing.mjs` exports (Task 1, imported but not yet called — wired in Task 5).
- Produces (used by Tasks 5, 6, 7): global `state` object in `app.js` with `state.mode` (`'utforska'|'cykla'|'quiz'`), `state.places` (array loaded from `places.json` + any custom landmarks), `state.map` (the Leaflet map instance), `state.markers` (Map of place id → Leaflet marker), `byId(id)` lookup, and the `malmokartan:place-click` / `malmokartan:mode-change` `document` events later tasks subscribe to instead of touching Utforska's internals directly.

- [ ] **Step 1: Create the shared photo placeholder**

Create `photos/placeholder.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#212826"/>
  <g fill="none" stroke="#B4ADA1" stroke-width="2.5" opacity="0.6">
    <rect x="120" y="95" width="160" height="110" rx="6"/>
    <circle cx="160" cy="130" r="14"/>
    <path d="M120 185l50-45 40 32 30-22 40 55" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="200" y="235" text-anchor="middle" font-family="-apple-system,'Segoe UI',sans-serif"
        font-size="12" letter-spacing="1.5" fill="#B4ADA1">FOTO KOMMER</text>
</svg>
```

Create `photos/README.md`:

```markdown
# Foton

En bild per plats, namngiven efter `photo`-fältet i `places.json` (t.ex. `ribban.jpg`).
Saknas filen visar sidan automatiskt `placeholder.svg` istället — lägg bara till
den riktiga filen med rätt namn i den här mappen, ingen kodändring behövs.

Rekommenderat format: liggande foto, minst 800px bred, JPEG.
```

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<title>Malmökartan</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  :root{
    --bg:#171B1A; --panel:#212826; --ink:#EDE8DE; --ink-soft:#B4ADA1;
    --accent:#3FC2D1; --accent-ink:#06262B; --line: rgba(237,232,222,0.12);
  }
  :root[data-theme="light"]{
    --bg:#F4F2EC; --panel:#FFFFFF; --ink:#1A1D1C; --ink-soft:#5B6460;
    --accent:#1B8A98; --accent-ink:#FFFFFF; --line: rgba(26,29,28,0.12);
  }
  @media (prefers-color-scheme: light){
    :root:not([data-theme="dark"]){
      --bg:#F4F2EC; --panel:#FFFFFF; --ink:#1A1D1C; --ink-soft:#5B6460;
      --accent:#1B8A98; --accent-ink:#FFFFFF; --line: rgba(26,29,28,0.12);
    }
  }
  *{box-sizing:border-box;}
  html,body{margin:0;height:100%;background:var(--bg);}
  body{
    font-family:-apple-system,'Segoe UI',sans-serif; color:var(--ink);
    display:flex; flex-direction:column; min-height:100vh;
  }
  header{ padding:14px 16px 8px; }
  h1{ font-size:18px; font-weight:800; margin:0; letter-spacing:-.01em; }
  .modes{ display:flex; gap:6px; padding:0 16px 10px; }
  .mode-btn{
    flex:1; min-height:40px; border-radius:9px; border:1px solid var(--line);
    background:var(--panel); color:var(--ink-soft); font:600 12.5px inherit;
    letter-spacing:.02em; cursor:pointer;
  }
  .mode-btn.active{ background:var(--accent); color:var(--accent-ink); border-color:transparent; }
  .board{ flex:1; display:grid; grid-template-columns: 1.3fr 1fr; gap:12px; padding:0 16px 16px; min-height:0; }
  @media (max-width:860px){ .board{ grid-template-columns:1fr; } }
  #map{ border-radius:12px; min-height:340px; }
  .side{ display:flex; flex-direction:column; gap:10px; overflow-y:auto; }
  .panel{ display:none; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; }
  .panel.active{ display:block; }
  .place-photo{ width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:10px; display:block; background:var(--bg); }
  .place-cat{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--accent); font-weight:700; margin-top:10px; }
  .place-name{ font-size:19px; font-weight:800; margin-top:2px; }
  .place-fact{ font-size:13.5px; color:var(--ink-soft); line-height:1.5; margin-top:8px; }
  .hint{ font-size:12.5px; color:var(--ink-soft); }
  .place-marker{ width:16px; height:16px; border-radius:50%; border:2px solid var(--bg); box-shadow:0 0 0 1px var(--line); }
</style>
</head>
<body>
  <header><h1>Malmökartan</h1></header>
  <div class="modes" role="tablist">
    <button class="mode-btn active" data-mode="utforska" role="tab">Utforska</button>
    <button class="mode-btn" data-mode="cykla" role="tab">Cykla</button>
    <button class="mode-btn" data-mode="quiz" role="tab">Quiz</button>
  </div>
  <div class="board">
    <div id="map"></div>
    <div class="side">
      <div class="panel active" id="panel-utforska">
        <p class="hint" id="explorePrompt">Tryck på en plats på kartan för att läsa om den.</p>
        <img class="place-photo" id="placePhoto" style="display:none;" alt="">
        <div class="place-cat" id="placeCat" style="display:none;"></div>
        <div class="place-name" id="placeName"></div>
        <p class="place-fact" id="placeFact"></p>
      </div>
      <div class="panel" id="panel-cykla"></div>
      <div class="panel" id="panel-quiz"></div>
    </div>
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `app.js` (map init, place loading, mode switching, Utforska mode)**

```js
import { buildGraph } from './routing.mjs';

const CAT_COLOR = {
  bad: '#3FC2D1', hamn: '#5FA8E8', park: '#7FBF8E', centrum: '#E0764F', oster: '#D9A752', egen: '#B4ADA1'
};

const state = {
  mode: 'utforska',
  places: [],
  routes: [],
  graph: null,
  map: null,
  markers: new Map() // plats-id -> L.CircleMarker
};

async function loadData() {
  const [places, routes] = await Promise.all([
    fetch('places.json').then(r => r.json()),
    fetch('routes.json').then(r => r.json())
  ]);
  state.places = places;
  state.routes = routes;
  state.graph = buildGraph(places, routes);
}

function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([55.5975, 13.010], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsgivare'
  }).addTo(state.map);
}

function renderMarkers() {
  for (const place of state.places) {
    const marker = L.circleMarker([place.lat, place.lon], {
      radius: 8, weight: 2, color: '#171B1A', fillColor: CAT_COLOR[place.category] || CAT_COLOR.egen, fillOpacity: 1
    }).addTo(state.map);
    marker.on('click', () => onPlaceClick(place));
    state.markers.set(place.id, marker);
  }
}

function byId(id) {
  return state.places.find(p => p.id === id);
}

function renderPlaceCard(place) {
  const photo = document.getElementById('placePhoto');
  photo.src = `photos/${place.photo}`;
  photo.alt = place.name;
  photo.style.display = '';
  photo.onerror = () => { photo.onerror = null; photo.src = 'photos/placeholder.svg'; };

  const CAT_LABEL = { bad: 'Kust & bad', hamn: 'Hamnen', park: 'Parker', centrum: 'Centrum & söder', oster: 'Öster & norr', egen: 'Din plats' };
  const cat = document.getElementById('placeCat');
  cat.textContent = CAT_LABEL[place.category] || '';
  cat.style.display = '';

  document.getElementById('placeName').textContent = place.name;
  document.getElementById('placeFact').textContent = place.fact;
  document.getElementById('explorePrompt').style.display = 'none';
}

// onPlaceClick beter sig olika beroende på läge — Utforska visar kortet,
// Cykla/Quiz (Task 5/6) skriver över den här funktionen genom att lyssna
// på ett CustomEvent så vi slipper en stor if-kedja här.
function onPlaceClick(place) {
  document.dispatchEvent(new CustomEvent('malmokartan:place-click', { detail: place }));
}
document.addEventListener('malmokartan:place-click', ev => {
  if (state.mode === 'utforska') renderPlaceCard(ev.detail);
});

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${mode}`));
  document.dispatchEvent(new CustomEvent('malmokartan:mode-change', { detail: mode }));
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

async function main() {
  initMap();
  try {
    await loadData();
  } catch (err) {
    document.getElementById('explorePrompt').textContent = 'Kunde inte ladda platsdata. Ladda om sidan.';
    return;
  }
  renderMarkers();
}

main();

export { state, byId, renderPlaceCard, CAT_COLOR };
```

- [ ] **Step 4: Manual verification**

Serve the directory and open it in a browser:

```bash
npx --yes serve .
```

Expected: page loads with the dark theme, a Leaflet/OSM map of Malmö centered on the city with 30 colored dots. Clicking a dot shows its photo (placeholder, since no real photos exist yet — confirm it's the sketched "FOTO KOMMER" placeholder, not a broken-image icon), category, name, and fact text in the side panel. Switching to the "Cykla" or "Quiz" tab shows an empty panel (built in Tasks 5–6) without breaking the map.

- [ ] **Step 5: Commit**

```bash
git add index.html app.js photos/
git commit -m "Add app shell, real map, and Utforska mode"
```

---

## Task 5: Cykla (route) mode

**Files:**
- Modify: `app.js`
- Modify: `index.html` (panel markup only)

**Interfaces:**
- Consumes: `state.graph`, `state.places`, `byId` from Task 4; `kShortest`, `meaningfulRoutes`, `routeLabel` from `routing.mjs` (Task 1).
- Produces: no new exports — self-contained mode.

- [ ] **Step 1: Add the Cykla panel markup**

In `index.html`, replace `<div class="panel" id="panel-cykla"></div>` with:

```html
<div class="panel" id="panel-cykla">
  <select id="fromSel" aria-label="Från" style="width:100%;padding:9px;border-radius:8px;background:var(--bg);color:var(--ink);border:1px solid var(--line);margin-bottom:6px;"></select>
  <select id="toSel" aria-label="Till" style="width:100%;padding:9px;border-radius:8px;background:var(--bg);color:var(--ink);border:1px solid var(--line);"></select>
  <div id="routeOpts" style="display:flex;flex-direction:column;gap:6px;margin-top:10px;"></div>
  <div id="routeLegs" style="display:flex;flex-direction:column;gap:0;margin-top:10px;"></div>
  <p class="hint" style="margin-top:10px;">Du kan också trycka på kartan: första trycket väljer start, andra väljer mål.</p>
</div>
```

- [ ] **Step 2: Add the Cykla logic to `app.js`**

Append to `app.js` (before the `main()` call, after `setMode`):

```js
import { kShortest, meaningfulRoutes, routeLabel } from './routing.mjs';

const cyklaState = { from: null, to: null, routeLines: [], selectedIndex: 0 };

function populateCyklaSelects() {
  const fromSel = document.getElementById('fromSel');
  const toSel = document.getElementById('toSel');
  const options = state.places
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
    .map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  fromSel.innerHTML = `<option value="">Från…</option>${options}`;
  toSel.innerHTML = `<option value="">Till…</option>${options}`;
}

function clearRouteLines() {
  cyklaState.routeLines.forEach(l => state.map.removeLayer(l));
  cyklaState.routeLines = [];
}

function drawRoutes(routes) {
  clearRouteLines();
  routes.forEach((route, i) => {
    const latlngs = route.legs.flatMap(leg => leg.geometry || [[byId(leg.from).lat, byId(leg.from).lon], [byId(leg.to).lat, byId(leg.to).lon]]);
    const line = L.polyline(latlngs, {
      color: '#3FC2D1', weight: i === cyklaState.selectedIndex ? 5 : 3,
      opacity: i === cyklaState.selectedIndex ? 0.95 : 0.3
    }).addTo(state.map);
    line.on('click', () => { cyklaState.selectedIndex = i; renderRouteResult(routes); });
    cyklaState.routeLines.push(line);
  });
  if (routes.length) state.map.fitBounds(cyklaState.routeLines[cyklaState.selectedIndex].getBounds(), { padding: [24, 24] });
}

function renderRouteResult(routes) {
  const optsEl = document.getElementById('routeOpts');
  const legsEl = document.getElementById('routeLegs');
  if (!routes.length) {
    optsEl.innerHTML = '<p class="hint">Ingen cykelväg hittades mellan de här platserna.</p>';
    legsEl.innerHTML = '';
    clearRouteLines();
    return;
  }
  const ref = routes[0];
  const placesById = Object.fromEntries(state.places.map(p => [p.id, p]));
  optsEl.innerHTML = routes.map((r, i) => {
    const label = i === 0 ? 'Snabbast' : routeLabel(r, ref, placesById);
    const km = (r.meters / 1000).toFixed(1);
    const active = i === cyklaState.selectedIndex ? 'style="border-color:#3FC2D1;background:rgba(63,194,209,.12);"' : '';
    return `<button type="button" class="route-opt" data-i="${i}" ${active}
      style="text-align:left;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;">
      <b>${label}</b> — ${km} km</button>`;
  }).join('');
  optsEl.querySelectorAll('.route-opt').forEach(btn => {
    btn.addEventListener('click', () => { cyklaState.selectedIndex = Number(btn.dataset.i); drawRoutes(routes); renderRouteResult(routes); });
  });

  const chosen = routes[cyklaState.selectedIndex];
  legsEl.innerHTML = chosen.legs.map((leg, i) => `
    <div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px dashed var(--line);font-size:13px;">
      <span style="flex:none;width:19px;height:19px;border-radius:50%;background:#3FC2D1;color:#06262B;font-size:10.5px;display:flex;align-items:center;justify-content:center;">${i + 1}</span>
      <span style="color:var(--ink-soft);">${byId(leg.from).name} → <b style="color:var(--ink);">${byId(leg.to).name}</b>, ${leg.via} (${Math.round(leg.meters)} m)</span>
    </div>`).join('');
  drawRoutes(routes);
}

function computeAndRenderRoute() {
  if (!cyklaState.from || !cyklaState.to || cyklaState.from === cyklaState.to) return;
  cyklaState.selectedIndex = 0;
  const routes = meaningfulRoutes(kShortest(state.graph, cyklaState.from, cyklaState.to, 3));
  renderRouteResult(routes);
}

document.getElementById('fromSel').addEventListener('change', e => { cyklaState.from = e.target.value || null; computeAndRenderRoute(); });
document.getElementById('toSel').addEventListener('change', e => { cyklaState.to = e.target.value || null; computeAndRenderRoute(); });

document.addEventListener('malmokartan:place-click', ev => {
  if (state.mode !== 'cykla') return;
  if (!cyklaState.from || (cyklaState.from && cyklaState.to)) {
    cyklaState.from = ev.detail.id; cyklaState.to = null;
    document.getElementById('fromSel').value = ev.detail.id;
    document.getElementById('toSel').value = '';
  } else {
    cyklaState.to = ev.detail.id;
    document.getElementById('toSel').value = ev.detail.id;
    computeAndRenderRoute();
  }
});

document.addEventListener('malmokartan:mode-change', ev => {
  if (ev.detail !== 'cykla') clearRouteLines();
});
```

Also change the end of `main()` to call `populateCyklaSelects()` after `renderMarkers()`:

```js
async function main() {
  initMap();
  try {
    await loadData();
  } catch (err) {
    document.getElementById('explorePrompt').textContent = 'Kunde inte ladda platsdata. Ladda om sidan.';
    return;
  }
  renderMarkers();
  populateCyklaSelects();
}
```

- [ ] **Step 3: Manual verification**

Reload the page (`npx --yes serve .`), switch to "Cykla", pick two places from the dropdowns (e.g. "Ribersborgsstranden" → "Turning Torso"). Expected: a turquoise route line appears on the map following real streets (not a straight line through buildings), a leg list with real street names appears below, and — for a pair with more than one reasonable path — a second route option button appears; clicking it re-draws the map with that route highlighted and the other dimmed. Clicking two markers on the map directly (instead of the dropdowns) should produce the same result.

- [ ] **Step 4: Commit**

```bash
git add index.html app.js
git commit -m "Add Cykla (route) mode with real street geometry"
```

---

## Task 6: Quiz mode

**Files:**
- Modify: `app.js`
- Modify: `index.html` (panel markup only)

**Interfaces:**
- Consumes: `isWithinTolerance` from `routing.mjs` (Task 1), `state.places`, `state.markers` from Task 4.
- Produces: no new exports — self-contained mode.

- [ ] **Step 1: Add the Quiz panel markup**

In `index.html`, replace `<div class="panel" id="panel-quiz"></div>` with:

```html
<div class="panel" id="panel-quiz">
  <div class="hint" id="quizPrompt">Tryck "Börja" för att spela.</div>
  <div id="quizPromptName" style="font-size:19px;font-weight:800;margin-top:6px;display:none;"></div>
  <div id="quizHearts" style="font-size:16px;letter-spacing:2px;margin-top:6px;"></div>
  <div id="quizStats" style="font-size:12.5px;color:var(--ink-soft);margin-top:2px;"></div>
  <div id="quizFeedback" style="min-height:20px;font-size:13.5px;margin-top:8px;"></div>
  <button type="button" id="quizStartBtn"
    style="margin-top:10px;min-height:40px;border-radius:9px;border:none;background:#3FC2D1;color:#06262B;font:700 13px inherit;cursor:pointer;">Börja</button>
</div>
```

- [ ] **Step 2: Add the Quiz logic to `app.js`**

Append to `app.js`:

```js
import { isWithinTolerance } from './routing.mjs';

const QUIZ_TOLERANCE_M = 150;
const quiz = { pool: [], current: null, hearts: 3, score: 0, total: 0, active: false };

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startQuiz() {
  quiz.pool = shuffle(state.places);
  quiz.hearts = 3; quiz.score = 0; quiz.total = 0; quiz.active = true;
  document.getElementById('quizPromptName').style.display = '';
  nextQuizQuestion();
}

function renderQuizStatus() {
  document.getElementById('quizHearts').textContent = '♥'.repeat(quiz.hearts) + '♡'.repeat(3 - quiz.hearts);
  document.getElementById('quizStats').textContent = `${quiz.score}/${quiz.total} rätt`;
}

function nextQuizQuestion() {
  if (quiz.hearts <= 0) { endQuiz(); return; }
  if (!quiz.pool.length) quiz.pool = shuffle(state.places);
  quiz.current = quiz.pool.shift();
  document.getElementById('quizPrompt').textContent = 'Tryck på kartan där den här platsen ligger:';
  document.getElementById('quizPromptName').textContent = quiz.current.name;
  document.getElementById('quizFeedback').textContent = '';
  renderQuizStatus();
}

function endQuiz() {
  quiz.active = false;
  document.getElementById('quizPrompt').textContent = `Slut! Du fick ${quiz.score} av ${quiz.total} rätt.`;
  document.getElementById('quizPromptName').style.display = 'none';
  document.getElementById('quizFeedback').textContent = '';
}

function handleQuizGuess(lat, lon) {
  if (!quiz.active || !quiz.current) return;
  quiz.total++;
  const correct = isWithinTolerance(lat, lon, quiz.current.lat, quiz.current.lon, QUIZ_TOLERANCE_M);
  const feedback = document.getElementById('quizFeedback');
  if (correct) {
    quiz.score++;
    feedback.textContent = `Rätt! Det var ${quiz.current.name}.`;
    feedback.style.color = '#7FBF8E';
  } else {
    quiz.hearts--;
    feedback.textContent = `Fel — ${quiz.current.name} låg någon annanstans.`;
    feedback.style.color = '#E0764F';
  }
  renderQuizStatus();
  setTimeout(nextQuizQuestion, 900);
}

document.getElementById('quizStartBtn').addEventListener('click', startQuiz);

document.addEventListener('malmokartan:place-click', ev => {
  if (state.mode === 'quiz') handleQuizGuess(ev.detail.lat, ev.detail.lon);
});
```

Clicks on the map that miss every marker also need to count as a quiz guess (a wrong click rarely lands exactly on a dot). Update `initMap()` in Task 4's code to also listen for generic map clicks and forward them when in quiz mode:

```js
function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([55.5975, 13.010], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsgivare'
  }).addTo(state.map);
  state.map.on('click', e => {
    if (state.mode === 'quiz') handleQuizGuess(e.latlng.lat, e.latlng.lng);
  });
}
```

(`handleQuizGuess` is defined later in the file than `initMap`, but both run after module evaluation completes and `main()` is called asynchronously, so the reference resolves fine — function declarations are hoisted.)

- [ ] **Step 3: Manual verification**

Reload the page, switch to "Quiz", click "Börja". Expected: a place name appears as the prompt. Clicking near the correct marker shows a green "Rätt!" message and advances after ~1s; clicking far away shows an orange "Fel" message, removes a heart, and advances. Losing all 3 hearts shows the final score and stops accepting clicks until "Börja" is pressed again.

- [ ] **Step 4: Commit**

```bash
git add index.html app.js
git commit -m "Add Seterra-style quiz mode"
```

---

## Task 7: Egna landmärken (custom landmarks)

**Files:**
- Modify: `app.js`
- Modify: `index.html` (panel markup + explore panel additions)
- Create: `test.mjs` (append unit tests for the storage functions)

**Interfaces:**
- Consumes: `state.places`, `renderMarkers` pattern from Task 4.
- Produces: `loadCustomLandmarks(storage)`/`saveCustomLandmarks(list, storage)` — exported from `app.js`'s logic but written as pure, storage-injectable functions so they're unit-testable without a browser `localStorage`.

- [ ] **Step 1: Write the failing tests**

Append to `test.mjs`. These test the pure serialization logic against a fake in-memory storage object (Node has no `localStorage`), so no DOM/browser is needed:

```js
function fakeStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v)
  };
}

test('saveCustomLandmarks / loadCustomLandmarks round-trip via injectable storage', async () => {
  const { saveCustomLandmarks, loadCustomLandmarks } = await import('./landmarks.mjs');
  const storage = fakeStorage();
  saveCustomLandmarks([{ name: 'Mitt gym', x: 400, y: 200 }], storage);
  const loaded = loadCustomLandmarks(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 'Mitt gym');
});

test('loadCustomLandmarks ignorerar korrupt data istället för att krascha', async () => {
  const { loadCustomLandmarks } = await import('./landmarks.mjs');
  const storage = fakeStorage();
  storage.setItem('malmokartan-landmarks-v1', 'inte json');
  assert.deepEqual(loadCustomLandmarks(storage), []);
});

test('loadCustomLandmarks filtrerar bort poster utan namn eller koordinater', async () => {
  const { loadCustomLandmarks } = await import('./landmarks.mjs');
  const storage = fakeStorage();
  storage.setItem('malmokartan-landmarks-v1', JSON.stringify([
    { name: 'Bra post', lat: 55.6, lon: 13.0 },
    { name: '', lat: 55.6, lon: 13.0 },
    { lat: 55.6, lon: 13.0 }
  ]));
  const loaded = loadCustomLandmarks(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 'Bra post');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test.mjs`
Expected: FAIL — `landmarks.mjs` does not exist.

- [ ] **Step 3: Create `landmarks.mjs`**

```js
// Ren, injectable-storage-logik för egna landmärken — testbar i Node utan
// en riktig localStorage. app.js anropar dessa med window.localStorage.
const KEY = 'malmokartan-landmarks-v1';
let counter = 0;

export function loadCustomLandmarks(storage) {
  let raw;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(l => l && typeof l.name === 'string' && l.name.trim() && typeof l.lat === 'number' && typeof l.lon === 'number')
    .map(l => ({
      id: `egen-${counter++}`, name: l.name, lat: l.lat, lon: l.lon,
      category: 'egen', fact: 'Ditt eget landmärke.', photo: 'placeholder.svg'
    }));
}

export function saveCustomLandmarks(list, storage) {
  try {
    storage.setItem(KEY, JSON.stringify(list.map(l => ({ name: l.name, lat: l.lat, lon: l.lon }))));
  } catch {
    // localStorage kan vara fullt eller avstängt (privat läge) — inte kritiskt, hoppa bara över sparning.
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test.mjs`
Expected: All previous tests plus these 3 new ones PASS.

- [ ] **Step 5: Wire it into the UI**

Add to `index.html`'s Utforska panel (`panel-utforska`), after the closing of the fact paragraph:

```html
<div id="ownLandmarks" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px;">
  <div class="place-cat" style="display:block;">Dina egna landmärken</div>
  <div id="lmList" style="display:flex;flex-direction:column;gap:2px;margin-top:6px;"></div>
  <form id="lmForm" style="display:flex;gap:6px;margin-top:8px;">
    <input id="lmInput" type="text" placeholder="T.ex. Mitt gym" maxlength="40"
      style="flex:1;padding:8px 10px;border-radius:8px;background:var(--bg);color:var(--ink);border:1px solid var(--line);">
    <button type="submit" style="padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;">Lägg till</button>
  </form>
  <p class="hint" id="placingHint" style="display:none;margin-top:6px;">Tryck på kartan där platsen ligger.</p>
</div>
```

Append to `app.js`:

```js
import { loadCustomLandmarks, saveCustomLandmarks } from './landmarks.mjs';

let customLandmarks = loadCustomLandmarks(window.localStorage);
let placingName = null;

function renderLandmarkMarkers() {
  customLandmarks.forEach(l => {
    if (state.markers.has(l.id)) return;
    const marker = L.circleMarker([l.lat, l.lon], {
      radius: 8, weight: 2, color: '#171B1A', fillColor: CAT_COLOR.egen, fillOpacity: 1
    }).addTo(state.map);
    marker.on('click', () => onPlaceClick(l));
    state.markers.set(l.id, marker);
  });
}

function renderLandmarkList() {
  const list = document.getElementById('lmList');
  if (!customLandmarks.length) { list.innerHTML = ''; return; }
  list.innerHTML = customLandmarks.map(l => `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;padding:5px 0;border-bottom:1px dashed var(--line);">
      <span>${l.name}</span>
      <button type="button" class="lm-del" data-id="${l.id}"
        style="border:none;background:none;color:#E0764F;cursor:pointer;font-size:12px;">Ta bort</button>
    </div>`).join('');
  list.querySelectorAll('.lm-del').forEach(btn => btn.addEventListener('click', () => removeLandmark(btn.dataset.id)));
}

function removeLandmark(id) {
  const marker = state.markers.get(id);
  if (marker) { state.map.removeLayer(marker); state.markers.delete(id); }
  customLandmarks = customLandmarks.filter(l => l.id !== id);
  state.places = state.places.filter(p => p.id !== id);
  saveCustomLandmarks(customLandmarks, window.localStorage);
  renderLandmarkList();
}

document.getElementById('lmForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('lmInput');
  const name = input.value.trim();
  if (!name) return;
  placingName = name;
  document.getElementById('placingHint').style.display = '';
  input.value = '';
});

function handlePlacingClick(e) {
  if (!placingName) return;
  const newLandmark = { id: `egen-${Date.now()}`, name: placingName, lat: e.latlng.lat, lon: e.latlng.lng, category: 'egen', fact: 'Ditt eget landmärke.', photo: 'placeholder.svg' };
  customLandmarks.push(newLandmark);
  state.places.push(newLandmark);
  saveCustomLandmarks(customLandmarks, window.localStorage);
  renderLandmarkMarkers();
  renderLandmarkList();
  placingName = null;
  document.getElementById('placingHint').style.display = 'none';
}
```

Update `initMap()` (from Tasks 4 & 6) to also call `handlePlacingClick` — replace the map click handler with:

```js
state.map.on('click', e => {
  if (placingName) { handlePlacingClick(e); return; }
  if (state.mode === 'quiz') handleQuizGuess(e.latlng.lat, e.latlng.lng);
});
```

Update `main()` to render existing landmarks on load:

```js
async function main() {
  initMap();
  try {
    await loadData();
  } catch (err) {
    document.getElementById('explorePrompt').textContent = 'Kunde inte ladda platsdata. Ladda om sidan.';
    return;
  }
  renderMarkers();
  renderLandmarkMarkers();
  renderLandmarkList();
  populateCyklaSelects();
}
```

- [ ] **Step 6: Manual verification**

Reload the page. Type a name in "Lägg till", submit, then click anywhere on the map — a new dot in the "egen" color appears, the name shows in the list under "Dina egna landmärken", and it appears as a possible quiz question. Reload the page (without clearing site data) — the landmark should still be there (persisted via `localStorage`). Click "Ta bort" — the marker and list entry disappear and stay gone after reload.

- [ ] **Step 7: Commit**

```bash
git add index.html app.js landmarks.mjs test.mjs
git commit -m "Add custom landmarks with localStorage persistence"
```

---

## Task 8: README, GitHub repo, and deploy

**Files:**
- Create: `README.md`

**Interfaces:**
- None (final integration task).

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Run the full test suite one last time**

Run: `node --test test.mjs`
Expected: All tests PASS (13 total: 7 from Task 1, 1 from Task 2, 2 from Task 3, 3 from Task 7).

- [ ] **Step 3: Commit the README**

```bash
git add README.md
git commit -m "Add README"
```

- [ ] **Step 4: Create the GitHub repository and push**

Confirm with Fredrik before this step — it creates a public repo and pushes code.

```bash
gh repo create malmokartan --public --source=. --remote=origin --push
```

Expected: repo created at `github.com/<user>/malmokartan`, `master` pushed, `origin` remote set.

- [ ] **Step 5: Enable GitHub Pages**

```bash
gh api repos/{owner}/malmokartan/pages -X POST -f "source[branch]=master" -f "source[path]=/" 2>/dev/null || \
gh api repos/{owner}/malmokartan/pages -X PUT -f "source[branch]=master" -f "source[path]=/"
```

Then verify: `gh api repos/{owner}/malmokartan/pages` should return `"status":"built"` (may take a minute after the first push — poll a few times if it says `"building"`).

- [ ] **Step 6: Verify live**

Open the returned `html_url` from the Pages API response in a browser. Expected: same behavior as the local manual-verification steps in Tasks 4–7 — map loads, all three modes work, custom landmarks persist per-browser.
