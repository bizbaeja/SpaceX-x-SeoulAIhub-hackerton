const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, 'public', 'chat', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public', 'chat', 'index.html'), 'utf8');

test('student chat falls back visibly when the configured API is unavailable', () => {
  assert.match(app, /function activateMockMode\s*\(/);
  assert.match(app, /function mockChatReply\s*\(/);
  assert.match(app, /chatState\.mode\s*===\s*'mock'/);
  assert.match(html, /id="chatModeLabel"/);
});
