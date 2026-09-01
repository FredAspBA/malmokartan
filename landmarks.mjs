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
