const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicDir = path.join(__dirname, 'public');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
test('entry routes students and staff to separate preserved surfaces', () => {
  const entry = fs.readFileSync(path.join(publicDir, 'entry.html'), 'utf8');
  const redirects = fs.readFileSync(path.join(publicDir, '_redirects'), 'utf8');
  assert.match(entry, /href="\/chat"/);
  assert.match(entry, /href="\/teacher"/);
  assert.match(redirects, /^\/\s+\/entry\.html\s+200/m);
  assert.match(redirects, /^\/chat\s+\/chat\/index\.html\s+200/m);
  assert.match(redirects, /^\/teacher\s+\/index\.html\s+200/m);
  const chat = fs.readFileSync(path.join(publicDir, 'chat', 'index.html'), 'utf8');
  assert.match(chat, /href="\/chat\/styles\.css"/);
  assert.match(chat, /src="\/chat\/app\.js"/);
});

test('local server mirrors the entry routes for development checks', () => {
  assert.match(server, /pathname === "\/" \? "entry\.html"/);
  assert.match(server, /pathname === "\/chat" \? "chat\/index\.html"/);
  assert.match(server, /pathname === "\/teacher" \? "index\.html"/);
});
