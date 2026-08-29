import { readFileSync, writeFileSync } from 'node:fs';
import { haversineMeters } from '../routing.mjs';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'malmokartan-dataprep/1.0 (privat projekt, se github.com/FredAspBA/malmokartan)';

const places = JSON.parse(readFileSync(new URL('../places.json', import.meta.url)));
const edgesSrc = JSON.parse(readFileSync(new URL('../routes-src.json', import.meta.url)));
const byId = Object.fromEntries(places.map(p => [p.id, p]));

function stripPrep(via) {
  return via.replace(/^(längs|genom|förbi|över|upp för)\s+/, '');
}

function nearestIndex(coords, lat, lon) {
  let best = 0, bestDist = Infinity;
  coords.forEach((c, i) => {
    const d = haversineMeters(lat, lon, c[0], c[1]);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return { index: best, dist: bestDist };
}

async function fetchWayGeometry(streetName, midLat, midLon) {
  const query = `[out:json][timeout:25];way["name"="${streetName}"](around:600,${midLat},${midLon});out geom;`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
    body: query
  });
  if (!res.ok) throw new Error(`Overpass svarade ${res.status}`);
  const data = await res.json();
  return data.elements.filter(el => el.type === 'way' && el.geometry);
}

async function geometryForEdge(edge) {
  const from = byId[edge.from], to = byId[edge.to];
  if (!from || !to) throw new Error(`Okänd plats i kant ${edge.from}->${edge.to}`);
  const streetName = stripPrep(edge.via);
  const midLat = (from.lat + to.lat) / 2, midLon = (from.lon + to.lon) / 2;
  const straight = [[from.lat, from.lon], [to.lat, to.lon]];

  let ways;
  try {
    ways = await fetchWayGeometry(streetName, midLat, midLon);
  } catch (err) {
    console.warn(`  ! Overpass-fel för ${edge.from}->${edge.to} (${streetName}): ${err.message} — rak linje`);
    return straight;
  }
  if (!ways.length) {
    console.warn(`  ! Ingen väg hittad för "${streetName}" nära ${edge.from}->${edge.to} — rak linje`);
    return straight;
  }

  // Välj den väg vars geometri ligger närmast både from och to.
  let best = null, bestScore = Infinity;
  for (const way of ways) {
    const coords = way.geometry.map(g => [g.lat, g.lon]);
    const nf = nearestIndex(coords, from.lat, from.lon);
    const nt = nearestIndex(coords, to.lat, to.lon);
    const score = nf.dist + nt.dist;
    if (score < bestScore) { bestScore = score; best = { coords, nf, nt }; }
  }
  if (bestScore > 300) {
    console.warn(`  ! Bästa träff för "${streetName}" ligger ${Math.round(bestScore)}m bort — rak linje`);
    return straight;
  }

  const { coords, nf, nt } = best;
  const [start, end] = nf.index <= nt.index ? [nf.index, nt.index] : [nt.index, nf.index];
  let slice = coords.slice(start, end + 1);
  if (slice.length < 2) return straight;
  if (nf.index > nt.index) slice = slice.reverse();
  return slice;
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
