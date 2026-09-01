import { buildGraph, kShortest, meaningfulRoutes, routeLabel, isWithinTolerance } from './routing.mjs';
import { loadCustomLandmarks, saveCustomLandmarks } from './landmarks.mjs';

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
  state.map.on('click', e => {
    if (placingName) { handlePlacingClick(e); return; }
    if (state.mode === 'quiz') handleQuizGuess(e.latlng.lat, e.latlng.lng);
  });
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
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  routes.forEach((route, i) => {
    const latlngs = route.legs.flatMap(leg => leg.geometry || [[byId(leg.from).lat, byId(leg.from).lon], [byId(leg.to).lat, byId(leg.to).lon]]);
    const line = L.polyline(latlngs, {
      color: accent, weight: i === cyklaState.selectedIndex ? 5 : 3,
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
    const active = i === cyklaState.selectedIndex ? 'style="border-color:var(--accent);background:var(--accent-tint);"' : '';
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
      <span style="flex:none;width:19px;height:19px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font-size:10.5px;display:flex;align-items:center;justify-content:center;">${i + 1}</span>
      <span style="color:var(--ink-soft);">${byId(leg.from).name} → <b style="color:var(--ink);">${byId(leg.to).name}</b>, ${leg.via} (${Math.round(leg.meters)} m)</span>
    </div>`).join('');
  drawRoutes(routes);
}

// Om valet är ofullständigt eller ogiltigt (samma plats i båda fälten)
// städas gamla resultat bort istället för att bara tyst göra ingenting —
// annars blir en tidigare visad rutt kvar på skärmen och pekar fel.
function clearRouteDisplay() {
  document.getElementById('routeOpts').innerHTML = '';
  document.getElementById('routeLegs').innerHTML = '';
  clearRouteLines();
}

function computeAndRenderRoute() {
  if (!cyklaState.from || !cyklaState.to) { clearRouteDisplay(); return; }
  if (cyklaState.from === cyklaState.to) {
    clearRouteDisplay();
    document.getElementById('routeOpts').innerHTML = '<p class="hint">Välj två olika platser.</p>';
    return;
  }
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
  if (!state.places.length) {
    document.getElementById('quizPrompt').textContent = 'Platsdata är inte klar än — vänta en stund och försök igen.';
    return;
  }
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

// quiz.current nollas direkt (innan setTimeout) så att ett klick som hinner
// komma innan nästa fråga är redo aldrig räknas som ännu en gissning på
// samma fråga. Detta skyddar mot två separata fall: (1) Leaflets
// circleMarker har bubblingMouseEvents:true som standard, så ett klick
// direkt på en markör triggrar både markörens egna klick (via
// malmokartan:place-click) OCH kartans generella click-event i samma
// synkrona sekvens — utan spärren skulle det räknas som två gissningar för
// ett enda klick. (2) Ett snabbt extra klick under den ~900ms långa
// väntetiden efter sista hjärtat skulle annars kunna göra quiz.hearts
// negativt, vilket kraschar '♥'.repeat(quiz.hearts) i renderQuizStatus.
function handleQuizGuess(lat, lon) {
  if (!quiz.active || !quiz.current) return;
  quiz.total++;
  const correct = isWithinTolerance(lat, lon, quiz.current.lat, quiz.current.lon, QUIZ_TOLERANCE_M);
  const feedback = document.getElementById('quizFeedback');
  if (correct) {
    quiz.score++;
    feedback.textContent = `Rätt! Det var ${quiz.current.name}.`;
    feedback.style.color = 'var(--success)';
  } else {
    quiz.hearts--;
    feedback.textContent = `Fel — ${quiz.current.name} låg någon annanstans.`;
    feedback.style.color = 'var(--error)';
  }
  quiz.current = null;
  renderQuizStatus();
  setTimeout(nextQuizQuestion, 900);
}

document.getElementById('quizStartBtn').addEventListener('click', startQuiz);

document.addEventListener('malmokartan:place-click', ev => {
  if (state.mode === 'quiz') handleQuizGuess(ev.detail.lat, ev.detail.lon);
});

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
        style="border:none;background:none;color:var(--error);cursor:pointer;font-size:12px;">Ta bort</button>
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

// Landmärkesplacering hör hemma i Utforska-panelen (formuläret finns bara
// där) — men state.mode kan bytas via lägesknapparna medan placingName
// fortfarande är satt (t.ex. skriv namn, tryck Lägg till, byt sedan till
// Quiz eller Cykla UTAN att klicka på kartan än). Utan den här spärren
// skulle nästa kartklick — avsett som quiz-gissning eller Cykla-val —
// tystat kapas och bli en landmärkesplacering istället, med
// "Tryck på kartan"-hintan gömd i den overksamma Utforska-panelen så
// användaren aldrig ser varför. Vi avbryter därför placeringsläget så
// fort man lämnar Utforska.
document.addEventListener('malmokartan:mode-change', ev => {
  if (ev.detail !== 'utforska' && placingName) {
    placingName = null;
    document.getElementById('placingHint').style.display = 'none';
  }
});

async function main() {
  initMap();
  try {
    await loadData();
  } catch (err) {
    document.getElementById('explorePrompt').textContent = 'Kunde inte ladda platsdata. Ladda om sidan.';
    return;
  }
  // Egna landmärken vävs in i state.places så de dyker upp i quizets
  // frågepool (se Interfaces-noten i task-briefen) och blir valbara
  // start/mål-alternativ i Cykla. De saknar kanter i state.graph, så
  // kShortest/shortestPath returnerar bara en tom lista om man väljer ett
  // eget landmärke som start eller mål i Cykla — inget krasch, bara
  // "Ingen cykelväg hittades" (verifierat mot routing.mjs).
  state.places.push(...customLandmarks);
  renderMarkers();
  renderLandmarkMarkers();
  renderLandmarkList();
  populateCyklaSelects();
}

main();

export { state, byId, renderPlaceCard, CAT_COLOR };
