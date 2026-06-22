#!/usr/bin/env node
/**
 * Pre-geocodes every stop in your itinerary CSV and writes data/coords.json,
 * a static lookup the website reads — so the deployed site makes ZERO live
 * geocoding calls. This keeps Nominatim usage on a personal machine, run
 * once per itinerary edit, well within their usage policy:
 *   https://operations.osmfoundation.org/policies/nominatim/
 *   - max 1 request/second (enforced below)
 *   - identifying User-Agent (set below — please edit the email)
 *   - results cached, not re-fetched (this script merges into the existing cache)
 *
 * Usage:
 *   1. Download your sheet as CSV (File > Download > CSV in Google Sheets,
 *      "Full Itinerary" tab) and save it as itinerary.csv in this folder.
 *   2. node scripts/geocode-itinerary.js itinerary.csv
 *   3. Commit/redeploy data/coords.json. Re-run whenever you add new stops.
 */
const fs = require('fs');
const path = require('path');

// IMPORTANT: replace with a real contact (per Nominatim policy, a generic
// User-Agent without identifying info will be blocked).
const USER_AGENT = 'NZTripPlanner/1.0 (personal use; contact: replace-with-your-email@example.com)';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/geocode-itinerary.js path/to/itinerary.csv');
  process.exit(1);
}

const Papa = requireOrInstallHint('papaparse');
function requireOrInstallHint(name) {
  try { return require(name); }
  catch (e) {
    console.error(`Missing dependency "${name}". Run: npm install ${name}`);
    process.exit(1);
  }
}

// --- reuse the same parsing/classification rules as the website (kept in sync manually) ---
const CATEGORY_RULES = [
  { cat: 'stay',     test: t => /STAY/i.test(t) || t.includes('🏕️') || t.includes('🏨') },
  { cat: 'drive',    test: t => /Drive|Pickup|Return/i.test(t) || t.includes('🚐') || t.includes('🚗') },
  { cat: 'flight',   test: t => /Flight/i.test(t) || t.includes('✈️') },
  { cat: 'fuel',     test: t => t.includes('⛽') },
  { cat: 'shop',     test: t => /Supplies/i.test(t) || t.includes('🛒') },
  { cat: 'waste',    test: t => /Waste/i.test(t) || t.includes('💩') },
  { cat: 'food',     test: t => /Food/i.test(t) || ['🍚','🍖','🍞','🍽️','🥧','🐟','☕','🥗','🦞'].some(e=>t.includes(e)) },
  { cat: 'wildlife', test: t => /Wildlife/i.test(t) || ['🦭','🐬','🦜','🪱','🐧','🐑'].some(e=>t.includes(e)) },
  { cat: 'water',    test: t => /Boat|Kayak|Cruise/i.test(t) || ['🚣','⛵','⛴️','🛶'].some(e=>t.includes(e)) },
  { cat: 'walk',     test: t => /Walk|Hike/i.test(t) || ['🚶','🥾','🥞','💎','💧','🌿','🪨','🔭','⛏️','🏔️','🏜️','🌊','🪞','🧊'].some(e=>t.includes(e)) },
  { cat: 'activity', test: () => true }
];
function classify(typeStr = '') {
  const t = String(typeStr).trim();
  if (!t) return 'activity';
  for (const rule of CATEGORY_RULES) if (rule.test(t)) return rule.cat;
  return 'activity';
}
const GENERIC_NAME_RE = /^(lunch|dinner|breakfast|snack|evening|morning|tba|tbc)$/i;
const TRAVEL_NAME_RE  = /^travel\s*\(/i;
function isGeocodable(name, category) {
  if (!name) return false;
  if (TRAVEL_NAME_RE.test(name)) return false;
  if (GENERIC_NAME_RE.test(name.trim())) return false;
  if (category === 'drive') return false;
  return true;
}
function parseDayHeader(col0) {
  const m = String(col0 || '').match(/^\s*DAY\s+(\d+)\s*[·\-—:]?\s*(.*)$/i);
  return m ? { num: +m[1], title: m[2].trim() } : null;
}

function extractStopNames(csvText) {
  const { data } = Papa.parse(csvText, { skipEmptyLines: true });
  const names = new Set();
  let inDay = false;
  for (const row of data) {
    if (parseDayHeader(row[0])) { inDay = true; continue; }
    if (!inDay) continue;
    const name = (row[7] || '').trim();
    const type = (row[8] || '').trim();
    if (!name || name.length < 2) continue;
    const category = classify(type);
    if (category === 'drive') continue;
    if (isGeocodable(name, category)) names.add(name);
  }
  return [...names];
}

// Strips warning emoji/annotations (e.g. "⚠️ BOOK AHEAD", "(Option A)") that hurt
// geocoder match quality, while keeping a mapping back to the original name so
// the site can still look coordinates up by the exact name in the sheet.
function cleanForGeocode(name) {
  return name
    .replace(/⚠️.*$/u, '')
    .replace(/\s*\(Option [A-Z]\)\s*$/i, '')
    .replace(/\s*\((Optional|To consider)[^)]*\)\s*$/i, '')
    .trim();
}

async function geocodeOne(name) {
  const query = cleanForGeocode(name);
  let g = await nominatimQuery(query);
  if (!g) {
    // fallback: try just the part before a dash/colon separator
    const short = query.split(/\s*[—\-:]\s*/)[0].trim();
    if (short && short !== query) {
      await new Promise(r => setTimeout(r, 1100)); // respect 1 req/sec for this extra call too
      g = await nominatimQuery(short);
    }
  }
  return g;
}

async function nominatimQuery(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nz&q=${encodeURIComponent(query + ', New Zealand')}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!j.length) return null;
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
}

async function main() {
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const names = extractStopNames(csvText);

  const outPath = path.join(__dirname, '..', 'data', 'coords.json');
  let cache = {};
  if (fs.existsSync(outPath)) cache = JSON.parse(fs.readFileSync(outPath, 'utf8'));

  const todo = names.filter(n => !(n in cache));
  console.log(`${names.length} stop names found, ${todo.length} need geocoding (${names.length - todo.length} already cached).`);

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    try {
      const g = await geocodeOne(name);
      cache[name] = g; // null is a valid cached "not found" result
      console.log(`[${i + 1}/${todo.length}] ${name} -> ${g ? `${g.lat},${g.lng}` : 'NOT FOUND'}`);
    } catch (e) {
      console.error(`[${i + 1}/${todo.length}] ${name} -> ERROR: ${e.message}`);
    }
    fs.writeFileSync(outPath, JSON.stringify(cache, null, 2));
    if (i < todo.length - 1) await new Promise(r => setTimeout(r, 1100)); // 1 req/sec max, per Nominatim policy
  }

  console.log(`\nDone. Wrote ${Object.keys(cache).length} cached coordinates to ${outPath}`);
  const notFound = Object.entries(cache).filter(([, v]) => v === null).map(([k]) => k);
  if (notFound.length) {
    console.log(`\n${notFound.length} place(s) could not be found automatically — add them manually in data/coords.json:`);
    notFound.forEach(n => console.log(`  - ${n}`));
  }
}

main();
