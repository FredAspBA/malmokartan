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
