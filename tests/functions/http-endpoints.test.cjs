// Guards the Cloud Functions HTTP endpoints: run with
//   (cd functions && npm ci) && GCLOUD_PROJECT=demo-fds-hub node --test tests/functions/http-endpoints.test.cjs
//
// The Firebase CLI makes every HTTP function PUBLIC (anyone on the internet
// can call it) unless the code says `invoker: "private"`. That is how the old
// debugDb / fixCalls / clearErrors / migrateDb / reprocessFailed admin tools
// ended up open to the world despite comments saying otherwise. So:
//   1. every HTTP function must either be `invoker: "private"` or be listed in
//      PUBLIC_ENDPOINTS below, and
//   2. every listed public endpoint must refuse a request that carries no
//      credentials.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const functions = require('../../functions/index.js');

// Public on purpose — each checks its own credentials. Adding a new public
// endpoint means adding it here AND making it refuse anonymous requests.
const PUBLIC_ENDPOINTS = {
  mangoWebhook: 'shared secret from Mango (MANGO_WEBHOOK_SECRET)',
  uploadRecording: 'approved hub user (requireApprovedUser)',
  lookupDentrix: 'approved hub user (requireApprovedUser)',
  refreshConfirmations: 'approved hub user (requireApprovedUser)',
  refreshHuddle: 'approved hub user (requireApprovedUser)',
};

const httpEndpoints = Object.entries(functions)
  .filter(([, fn]) => fn.__endpoint && fn.__endpoint.httpsTrigger)
  .map(([name, fn]) => ({ name, fn, invoker: fn.__endpoint.httpsTrigger.invoker }));

// Calls an exported handler with a minimal fake request/response.
function call(handler, { method = 'POST', headers = {}, query = {}, body = {} } = {}) {
  return new Promise((resolve) => {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req = {
      method, headers: h, query, body, url: '/',
      rawBody: Buffer.from(JSON.stringify(body)),
      get: (name) => h[name.toLowerCase()],
    };
    const done = (b) => { resolve({ status: res.statusCode, body: b }); return res; };
    const res = {
      statusCode: 200,
      set() { return res; }, setHeader() {}, getHeader() {}, on() {},
      status(code) { res.statusCode = code; return res; },
      json: done, send: done, end: done,
    };
    handler(req, res);
  });
}

test('every HTTP function is private or a known, self-authenticating public endpoint', () => {
  assert.ok(httpEndpoints.length > 0, 'found no HTTP functions — did the export shape change?');
  for (const { name, invoker } of httpEndpoints) {
    const isPrivate = Array.isArray(invoker) && invoker.includes('private');
    assert.ok(
      isPrivate || name in PUBLIC_ENDPOINTS,
      `${name} would be deployed as PUBLIC (invoker: ${JSON.stringify(invoker ?? 'unset')}). ` +
      'Set invoker: "private", or add it to PUBLIC_ENDPOINTS once it checks credentials itself.',
    );
  }
});

test('every listed public endpoint still exists', () => {
  for (const name of Object.keys(PUBLIC_ENDPOINTS)) {
    assert.ok(httpEndpoints.some((e) => e.name === name), `${name} is listed but no longer exported`);
  }
});

test('approved-user endpoints refuse requests with no sign-in', async () => {
  for (const { name, fn } of httpEndpoints) {
    if (name === 'mangoWebhook' || !(name in PUBLIC_ENDPOINTS)) continue;
    const res = await call(fn, { query: { office: 'glendale', callId: 'x' } });
    assert.equal(res.status, 401, `${name} answered ${res.status} to an anonymous request`);
  }
});

test('mangoWebhook refuses requests without the right key', async () => {
  const hook = functions.mangoWebhook;
  const previous = process.env.MANGO_WEBHOOK_SECRET;
  try {
    delete process.env.MANGO_WEBHOOK_SECRET;
    assert.equal((await call(hook, { body: {} })).status, 401, 'accepted a request while the secret is unset');

    process.env.MANGO_WEBHOOK_SECRET = 'test-secret';
    assert.equal((await call(hook, { body: {} })).status, 401, 'accepted a request with no key');
    assert.equal((await call(hook, { query: { key: 'wrong' }, body: {} })).status, 401, 'accepted a wrong key');
    // The right key gets past the check; the empty payload is then refused
    // before anything is written.
    assert.equal((await call(hook, { query: { key: 'test-secret' }, body: {} })).status, 400);
    assert.equal((await call(hook, { headers: { 'X-Webhook-Key': 'test-secret' }, body: {} })).status, 400);
  } finally {
    if (previous === undefined) delete process.env.MANGO_WEBHOOK_SECRET;
    else process.env.MANGO_WEBHOOK_SECRET = previous;
  }
});
