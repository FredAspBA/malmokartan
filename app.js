import { buildGraph, kShortest, meaningfulRoutes, routeLabel } from './routing.mjs';

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

main();

export { state, byId, renderPlaceCard, CAT_COLOR };
