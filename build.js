const fs = require('fs');
const out = `window.APP_CONFIG = {
  DEFAULT_SHEET_CSV: ${JSON.stringify(process.env.DEFAULT_SHEET_CSV || '')}
};`;
fs.writeFileSync('config.js', out);
console.log('Wrote config.js');
