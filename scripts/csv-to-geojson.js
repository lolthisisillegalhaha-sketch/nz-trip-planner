#!/usr/bin/env node
/**
 * Converts a DOC Campsites CSV export (from data.govt.nz / DOC Open Spatial Data)
 * into the data/doc-campsites.geojson file this app reads.
 *
 * Usage:
 *   node scripts/csv-to-geojson.js path/to/doc-campsites.csv
 *
 * If you instead downloaded a GeoJSON directly from the DOC Open Spatial Data
 * portal, you don't need this script — just save it as data/doc-campsites.geojson.
 *
 * DOC's CSV column names have varied over time (e.g. "Name"/"name", "Latitude"/"Y",
 * "Longitude"/"X"). This script tries a few common variants.
 */
const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/csv-to-geojson.js path/to/doc-campsites.csv');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');
const lines = raw.split(/\r?\n/).filter(l => l.trim().length);
const headers = parseCsvLine(lines[0]).map(h => h.trim());

function parseCsvLine(line) {
  // minimal CSV parser handling quoted fields
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function findCol(candidates) {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase() === c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

const nameIdx = findCol(['name', 'campsitename', 'site_name', 'asset_name']);
const latIdx  = findCol(['latitude', 'lat', 'y']);
const lngIdx  = findCol(['longitude', 'lon', 'lng', 'x']);

if (latIdx === -1 || lngIdx === -1) {
  console.error('Could not find latitude/longitude columns. Headers found:', headers);
  console.error('Edit scripts/csv-to-geojson.js findCol() calls to match your file.');
  process.exit(1);
}

const features = [];
for (let i = 1; i < lines.length; i++) {
  const row = parseCsvLine(lines[i]);
  const lat = parseFloat(row[latIdx]);
  const lng = parseFloat(row[lngIdx]);
  if (isNaN(lat) || isNaN(lng)) continue;
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { name: nameIdx >= 0 ? row[nameIdx] : 'DOC Campsite' }
  });
}

const geojson = { type: 'FeatureCollection', features };
const outPath = path.join(__dirname, '..', 'data', 'doc-campsites.geojson');
fs.writeFileSync(outPath, JSON.stringify(geojson, null, 2));
console.log(`Wrote ${features.length} campsites to ${outPath}`);
