const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function makeStore(filename, defaultValue) {
  const dir = path.join(app.getPath('userData'), 'nova-data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);

  let data = defaultValue;
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      data = JSON.parse(raw);
    }
  } catch (e) {
    data = defaultValue;
  }

  const save = () => {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
    catch (e) { console.error('store save failed', e); }
  };

  return { data, save, file };
}

module.exports = { makeStore };