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
