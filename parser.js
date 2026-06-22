// Parses the published CSV of NZ_Itinerary_Updated.xlsx "Full Itinerary" tab.
// Columns (by index): 0:Day 1:Date 2:Start 3:End 4:Mins 5:Duration
// 6:Distance 7:Activity 8:Type 9:DriveToNext 10:Cost 11:Notes
//
// Returns: [{ dayNum, dayTitle, stops: [{name, type, category, startTime, endTime,
//                                        durationMin, distanceKm, driveToNext, cost,
//                                        notes, geocodable}] }]

// Emoji/keyword -> category. Order matters: first match wins.
// 'drive' rows are filtered out entirely (they're transit legs, not stops).
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
  { cat: 'activity', test: () => true } // fallback: Tour, Farm, Adventure, Sightseeing, Viewpoint, Explore, Experience, etc.
];

function classify(typeStr = '') {
  const t = String(typeStr).trim();
  if (!t) return 'activity';
  for (const rule of CATEGORY_RULES) if (rule.test(t)) return rule.cat;
  return 'activity';
}

// Names that are too generic to geocode sensibly on their own
// (meals/waste/supplies with no real place attached, or pure transit descriptions)
const GENERIC_NAME_RE = /^(lunch|dinner|breakfast|snack|evening|morning|tba|tbc)$/i;
const TRAVEL_NAME_RE  = /^travel\s*\(/i;

function isGeocodable(name, category) {
  if (!name) return false;
  if (TRAVEL_NAME_RE.test(name)) return false;
  if (GENERIC_NAME_RE.test(name.trim())) return false;
  if (category === 'drive') return false;
  return true;
}

// Detect day header rows like "  DAY 1  ·  Sun 1 Nov  ·  CHRISTCHURCH — Arrival"
// Must be anchored to the start of column 0 (after optional whitespace) so that
// notes text mentioning "Day 1" elsewhere in the row is never mistaken for a header.
function parseDayHeader(col0) {
  const m = String(col0 || '').match(/^\s*DAY\s+(\d+)\s*[·\-—:]?\s*(.*)$/i);
  return m ? { num: +m[1], title: m[2].trim() } : null;
}

function toMinutes(timeStr) {
  if (!timeStr) return null;
  // handles "08:45:00" or "08:45" or "Evening"
  const m = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

function durationMinFromCell(cell) {
  if (cell === null || cell === undefined || cell === '') return null;
  const num = parseFloat(cell);
  if (!isNaN(num) && num < 1000) return num;
  const str = String(cell);
  let mins = 0, found = false;
  const h = str.match(/(\d+)\s*hr/);  if (h) { mins += (+h[1]) * 60; found = true; }
  const m = str.match(/(\d+)\s*min/); if (m) { mins += (+m[1]); found = true; }
  return found ? mins : null;
}

function parseCsv(csvText) {
  const { data } = Papa.parse(csvText, { skipEmptyLines: true });
  const days = [];
  let currentDay = null;

  for (const row of data) {
    const hdr = parseDayHeader(row[0]);
    if (hdr) {
      currentDay = { dayNum: hdr.num, dayTitle: hdr.title, stops: [] };
      days.push(currentDay);
      continue;
    }
    if (!currentDay) continue;

    const name = (row[7] || '').trim();
    const type = (row[8] || '').trim();
    if (!name || name.length < 2) continue; // skip blank rows
    const category = classify(type);
    if (category === 'drive') continue;     // skip pure-travel legs, not real stops

    currentDay.stops.push({
      name,
      type,
      category,
      startTime:   row[2],
      endTime:     row[3],
      durationMin: durationMinFromCell(row[4]) ?? durationMinFromCell(row[5]),
      distanceKm:  parseFloat(row[6]) || null,
      driveToNext: row[9],
      cost:        row[10],
      notes:       row[11],
      geocodable:  isGeocodable(name, category)
    });
  }
  return days;
}

window.ItineraryParser = { parseCsv, classify, isGeocodable };
