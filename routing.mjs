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
