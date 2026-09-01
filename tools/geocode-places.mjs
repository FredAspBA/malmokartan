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

writeFileSync(new URL('../places.json', import.meta.url), JSON.stringify(places, null, 2) + '\n');
console.log(`\nSkrev places.json med ${places.length} platser.`);
