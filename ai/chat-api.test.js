const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { server } = require('./server');

let baseUrl;

test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('student chat starts a session and returns a compassionate reply', async () => {
  const session = await request('/api/chat/sessions', { ageBand: '13-15', region: '강남구' });
  assert.equal(session.status, 201);
  assert.ok(session.body.sessionId);

  const reply = await request(`/api/chat/sessions/${session.body.sessionId}/messages`, { content: '오늘 친구와 다퉜어' });
  assert.equal(reply.status, 200);
  assert.match(reply.body.message.content, /친구|마음/);
});

test('student chat gives crisis resources for direct suicidal language', async () => {
  const session = await request('/api/chat/sessions', { ageBand: '13-15', region: '강남구' });
  const reply = await request(`/api/chat/sessions/${session.body.sessionId}/messages`, { content: '죽을래' });
  assert.equal(reply.status, 200);
  assert.match(reply.body.message.content, /109/);
  assert.match(reply.body.message.content, /1388/);
  assert.equal(reply.body.resources[0].contact, '109');
});

test('student chat streams replies for the browser chat client', async () => {
  const session = await request('/api/chat/sessions', { ageBand: '13-15', region: '강남구' });
  const response = await fetch(`${baseUrl}/api/chat/sessions/${session.body.sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '오늘 학교가 힘들어', stream: true })
  });
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.match(await response.text(), /event: done/);
});

test('help request creates a minimum-information case without returning transcript', async () => {
  const session = await request('/api/chat/sessions', { ageBand: '13-15', region: '강남구' });
  await request(`/api/chat/sessions/${session.body.sessionId}/messages`, { content: '친구와 다투고 너무 힘들어' });
  const handoff = await request(`/api/chat/sessions/${session.body.sessionId}/help-request`, { consentToShare: true });
  assert.equal(handoff.status, 201);
  assert.ok(handoff.body.caseId);
  assert.equal('summary' in handoff.body, false);
  assert.equal(JSON.stringify(handoff.body).includes('친구와 다투고'), false);
});
