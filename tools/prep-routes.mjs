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
  // kommentaren vid bboxFor). Söksökrutan är redan den geografiska filtret;
  // den enda ytterligare kontrollen är att den ihopsatta vägen inte blir
  // orimligt lång (nedan). Avstånden loggas ändå, som information.
  const route = shortestPath(graph, fromNode.id, toNode.id);
  if (!route) {
    console.warn(`  ! "${streetName}"-segmenten hänger inte ihop mellan ${edge.from} och ${edge.to} (närmast: ${Math.round(fromNode.dist)}m/${Math.round(toNode.dist)}m) — rak linje`);
    return straight;
  }
  if (route.meters > straightM * 3) {
    console.warn(`  ! Ihopfogad väg via "${streetName}" är ${Math.round(route.meters)}m, orimligt mycket längre än ${Math.round(straightM)}m fågelvägen — rak linje`);
    return straight;
  }

  // Foga ihop den riktiga platskoordinaten i varje ände med gatans geometri
  // — annars slutar linjen mitt i en gata istället för vid markören.
  const streetPoints = pathNodes(route).map(id => pointOf[id]);
  return [[from.lat, from.lon], ...streetPoints, [to.lat, to.lon]];
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
