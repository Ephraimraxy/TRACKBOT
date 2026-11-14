// Live check against a RUNNING app (npm run dev) seeded with `npm run seed:demo`.
// Usage: node tests/live/tracking-flow.mjs
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PW = process.env.TEST_PASSWORD ?? 'Test1234!';
let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie } })).json();
  return { cookie, id: s.user?.id };
}
async function call(method, path, who, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: { 'content-type': 'application/json', cookie: who?.cookie ?? '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

const client = await login('client@email.com');
const stranger = await login('client1@email.com');
const admin = await login('admin@email.com');
const driver = await login('livreur1@email.com');
const otherDriver = await login('livreur2@email.com');

const productId = (await call('GET', '/api/products?pageSize=1')).body.data[0].id;
const order = await call('POST', '/api/orders', client, {
  userId: client.id,
  addresse: { rue: '5 Rue GPS', ville: 'Keffi', wilaya: 'Nasarawa', codePostal: '961101' },
  produits: [{ produitId: productId, quantite: 1 }],
});
const id = order.body.data.id;
for (const s of ['EN_PREPARATION', 'EXPEDIEE']) await call('PATCH', `/api/orders/${id}/status`, admin, { statut: s });
await call('POST', `/api/orders/${id}/assign`, admin, { driverId: driver.id });

const here = { latitude: 8.8418, longitude: 7.8736, accuracy: 15 };

check('no tracking before pickup (409)', (await call('POST', `/api/delivery/orders/${id}/location`, driver, here)).status === 409);
let t = await call('GET', `/api/orders/${id}/tracking`, client);
check('customer sees status, no location yet', t.status === 200 && t.body.data.location === null && t.body.data.trackingActive === false);

await call('PATCH', `/api/delivery/orders/${id}/status`, driver, { statut: 'EN_LIVRAISON' });
t = await call('GET', `/api/orders/${id}/tracking`, client);
check('out for delivery: tracking active, still no point', t.body.data.trackingActive === true && t.body.data.location === null);

check('other driver cannot post (403)', (await call('POST', `/api/delivery/orders/${id}/location`, otherDriver, here)).status === 403);
check('customer cannot post (403)', (await call('POST', `/api/delivery/orders/${id}/location`, client, here)).status === 403);
check('admin cannot post (403)', (await call('POST', `/api/delivery/orders/${id}/location`, admin, here)).status === 403);
check('anonymous cannot post (401)', (await call('POST', `/api/delivery/orders/${id}/location`, null, here)).status === 401);
check('invalid coordinates rejected (400)', (await call('POST', `/api/delivery/orders/${id}/location`, driver, { latitude: 123, longitude: 7 })).status === 400);

check('driver posts a point (201)', (await call('POST', `/api/delivery/orders/${id}/location`, driver, here)).status === 201);
check('immediate repeat is throttled (429)', (await call('POST', `/api/delivery/orders/${id}/location`, driver, here)).status === 429);

t = await call('GET', `/api/orders/${id}/tracking`, client);
check('customer sees the point', t.body.data.location?.latitude === here.latitude && t.body.data.location?.longitude === here.longitude);
check('driver privacy: first name only, no ids/emails', typeof t.body.data.driverFirstName === 'string' && !JSON.stringify(t.body).includes(driver.id) && !JSON.stringify(t.body).includes('livreur1@'));
check('stranger cannot read tracking (403)', (await call('GET', `/api/orders/${id}/tracking`, stranger)).status === 403);
check('anonymous cannot read tracking (401)', (await call('GET', `/api/orders/${id}/tracking`, null)).status === 401);

await sleep(2500);
const moved = { latitude: 8.8450, longitude: 7.8790, accuracy: 10 };
check('second point accepted after interval (201)', (await call('POST', `/api/delivery/orders/${id}/location`, driver, moved)).status === 201);
t = await call('GET', `/api/orders/${id}/tracking`, client);
check('customer sees the NEWEST point', t.body.data.location?.latitude === moved.latitude);

const page = await fetch(`${BASE}/client/orders/${id}/track`, { redirect: 'manual', headers: { cookie: client.cookie } });
check('tracking page renders for the customer', page.status === 200, `status=${page.status}`);
const anonPage = await fetch(`${BASE}/client/orders/${id}/track`, { redirect: 'manual' });
check('tracking page redirects anonymous to login', anonPage.status >= 300 && anonPage.status < 400);

await call('PATCH', `/api/delivery/orders/${id}/status`, driver, { statut: 'LIVREE' });
t = await call('GET', `/api/orders/${id}/tracking`, client);
// Delivered is not the end: the delivery stays open and the map keeps showing where the driver stopped.
check('after "delivered" the delivery stays open, waiting for the customer', t.body.data.status === 'LIVREE' && t.body.data.awaitingConfirmation === true && t.body.data.mapOpen === true && t.body.data.location !== null && t.body.data.trackingActive === false);
check('after delivered the driver cannot post more positions (409)', (await call('POST', `/api/delivery/orders/${id}/location`, driver, moved)).status === 409);
check('the driver cannot close the delivery', (await call('POST', `/api/orders/${id}/receive`, driver)).status === 403);
check('another customer cannot close it', (await call('POST', `/api/orders/${id}/receive`, stranger)).status === 404);
check('the owner is not a customer, so the customer endpoint refuses', (await call('POST', `/api/orders/${id}/receive`, admin)).status === 403);

const received = await call('POST', `/api/orders/${id}/receive`, client);
check('the customer confirms receipt (200)', received.status === 200 && received.body.data.statut === 'RECUE');
t = await call('GET', `/api/orders/${id}/tracking`, client);
check('once received the location is no longer exposed', t.body.data.status === 'RECUE' && t.body.data.location === null && t.body.data.mapOpen === false);
check('confirming twice is refused (409)', (await call('POST', `/api/orders/${id}/receive`, client)).status === 409);
check('timeline has all six steps plus the placed order', t.body.data.history.length === 6);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
