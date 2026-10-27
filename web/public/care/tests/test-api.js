/* Dependency-free test of the two model calls: node tests/test-api.js */
const path = require('node:path');
require(path.resolve(__dirname, '..', 'body-selector.js'));
const api = globalThis.CareAnatomy;
const assert = (c, m) => { if (!c) throw new Error(m); };
const TEXT = 'chest pain; left hand tingling;';

(async () => {
  // request shapes (exactly the contract: /predict {text}, /risk {text, sex})
  const reqs = api.buildRequests({ text: '  ' + TEXT + ' ', sex: 'female', modelApi: 'https://m.example.com/', riskApi: 'https://r.example.com//' });
  assert(reqs.length === 2, 'two requests expected');
  assert(reqs[0].url === 'https://m.example.com/predict' && JSON.stringify(reqs[0].body) === JSON.stringify({ text: TEXT }), 'predict request wrong');
  assert(reqs[1].url === 'https://r.example.com/risk' && JSON.stringify(reqs[1].body) === JSON.stringify({ text: TEXT, sex: 'female' }), 'risk request wrong');
  assert(api.buildRequests({ text: TEXT, sex: 'male', modelApi: '', riskApi: '' }).length === 0, 'no endpoints -> no requests');
  assert(api.buildRequests({ text: TEXT, sex: 'x', riskApi: 'http://r' })[0].body.sex === 'male', 'sex defaults to a valid value');

  // happy path: method, header, body, parallel results
  const calls = [];
  const ok = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => (url.endsWith('/predict') ? { department: 'cardiology' } : { risk: 'medium' }) }; };
  let r = await api.analyze({ text: TEXT, sex: 'female', modelApi: 'http://m', riskApi: 'http://r', fetchImpl: ok });
  assert(calls.length === 2, 'both services called');
  calls.forEach(c => { assert(c.init.method === 'POST', 'POST'); assert(c.init.headers['Content-Type'] === 'application/json', 'content-type'); });
  assert(JSON.parse(calls[1].init.body).sex === 'female', 'sex sent to /risk');
  assert(!('sex' in JSON.parse(calls[0].init.body)), 'sex is not sent to /predict');
  assert(r.ok && r.predict.department === 'cardiology' && r.risk.risk === 'medium', 'results mapped');

  // one service fails: the other result is still returned
  const half = async url => url.endsWith('/risk') ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, json: async () => ({ department: 'neurology' }) };
  r = await api.analyze({ text: TEXT, sex: 'male', modelApi: 'http://m', riskApi: 'http://r', fetchImpl: half });
  assert(!r.ok && r.predict.department === 'neurology' && r.risk === null && /500/.test(r.errors.risk) && r.errors.predict === null, 'partial failure handled');

  // network error / timeout
  r = await api.analyze({ text: TEXT, sex: 'male', modelApi: 'http://m', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert(!r.ok && /Failed to fetch/.test(r.errors.predict), 'network error reported');
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => { const e = new Error('x'); e.name = 'AbortError'; rej(e); }));
  r = await api.analyze({ text: TEXT, sex: 'male', riskApi: 'http://r', timeoutMs: 30, fetchImpl: hang });
  assert(!r.ok && r.errors.risk === 'timed out', 'timeout reported');

  // the emergency decision is gone from the input layer
  assert(!JSON.stringify(api.inside).includes('urgent'), 'inside data must not carry urgent flags');
  console.log('PASS: model-call contract, partial failure, network error and timeout.');
})().catch(e => { console.error(e); process.exitCode = 1; });
