const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const blueprint = fs.readFileSync(path.join(__dirname, 'render.yaml'), 'utf8');

test('Render blueprint deploys the existing youth chat backend with external secrets', () => {
  assert.match(blueprint, /rootDir: space-x-seoulaihub-hackerton\/backend/);
  assert.match(blueprint, /buildCommand: npm ci && npm run build/);
  assert.match(blueprint, /startCommand: npm start/);
  assert.match(blueprint, /healthCheckPath: \/api\/health/);
  assert.match(blueprint, /key: GEMINI_API_KEY\s+sync: false/);
  assert.match(blueprint, /key: DATABASE_URL\s+sync: false/);
});
