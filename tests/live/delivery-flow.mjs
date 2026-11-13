const BASE = 'http://localhost:3000';
const PW = 'Test1234!';
let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
};

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie } })).json();
  return { cookie, id: s.user?.id, role: s.user?.role, status: r.status };
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
  return { status: r.status, body: j, location: r.headers.get('location') };
}

const client = await login('client@email.com');
const admin = await login('admin@email.com');
const d1 = await login('livreur1@email.com');
const d2 = await login('livreur2@email.com');
check('logins (client/admin/driver1/driver2)', [client, admin, d1, d2].every((u) => u.status === 200), `roles=${[client, admin, d1, d2].map((u) => u.role)}`);

// product with stock
const prods = await call('GET', '/api/products?pageSize=1');
const productId = prods.body.data[0].id;

// 1 customer orders
const order = await call('POST', '/api/orders', client, {
  userId: client.id,
  addresse: { rue: '12 Rue Live', ville: 'Keffi', wilaya: 'Nasarawa', codePostal: '961101' },
  produits: [{ produitId: productId, quantite: 1 }],
  payment: { cardNumber: '4242424242424242', cvc: '123', expirationDate: '12/30', legalName: 'Live Test' },
});
check('customer places order', order.status === 201, `status=${order.status}`);
const orderId = order.body?.data?.id;

// 2 admin: process, then ship
check('admin -> Processing', (await call('PATCH', `/api/orders/${orderId}/status`, admin, { statut: 'EN_PREPARATION' })).status === 200);
check('admin -> Shipped', (await call('PATCH', `/api/orders/${orderId}/status`, admin, { statut: 'EXPEDIEE' })).status === 200);

// 3 board + drivers + assign
const drivers = await call('GET', '/api/drivers', admin);
check('admin lists drivers', drivers.status === 200 && drivers.body.data.length >= 2, `n=${drivers.body?.data?.length}`);
const board = await call('GET', '/api/deliveries', admin);
check('admin board shows the order', board.status === 200 && board.body.data.some((o) => o.id === orderId));
check('driver cannot assign', (await call('POST', `/api/orders/${orderId}/assign`, d1, { driverId: d1.id })).status === 403);
check('customer cannot assign', (await call('POST', `/api/orders/${orderId}/assign`, client, { driverId: d1.id })).status === 403);
check('cannot assign a non-driver', (await call('POST', `/api/orders/${orderId}/assign`, admin, { driverId: client.id })).status === 400);
check('admin assigns driver1', (await call('POST', `/api/orders/${orderId}/assign`, admin, { driverId: d1.id })).status === 200);

// 4 driver isolation
const mine = await call('GET', '/api/delivery/orders', d1);
const theirs = await call('GET', '/api/delivery/orders', d2);
check('driver1 sees the order', mine.body?.data?.some((d) => d.commande.id === orderId));
check('driver2 does not see it', !theirs.body?.data?.some((d) => d.commande.id === orderId));
check('driver2 cannot change it', (await call('PATCH', `/api/delivery/orders/${orderId}/status`, d2, { statut: 'EN_LIVRAISON' })).status === 403);
check('admin cannot use driver endpoint', (await call('PATCH', `/api/delivery/orders/${orderId}/status`, admin, { statut: 'EN_LIVRAISON' })).status === 403);
check('driver cannot skip to Delivered', (await call('PATCH', `/api/delivery/orders/${orderId}/status`, d1, { statut: 'LIVREE' })).status === 409);

// 5 delivery
check('driver1 -> Out for delivery', (await call('PATCH', `/api/delivery/orders/${orderId}/status`, d1, { statut: 'EN_LIVRAISON' })).status === 200);
check('reassign now blocked', (await call('POST', `/api/orders/${orderId}/assign`, admin, { driverId: d2.id })).status === 409);
check('driver1 -> Delivered', (await call('PATCH', `/api/delivery/orders/${orderId}/status`, d1, { statut: 'LIVREE', note: 'Handed over' })).status === 200);

// 6 customer's view
const hist = await call('GET', `/api/orders/${orderId}/history`, client);
const steps = hist.body?.data?.history?.map((h) => h.to);
check('customer timeline complete', JSON.stringify(steps) === JSON.stringify(['EN_COURS', 'EN_PREPARATION', 'EXPEDIEE', 'EN_LIVRAISON', 'LIVREE']), JSON.stringify(steps));
check('other customer cannot read timeline', (await call('GET', `/api/orders/${orderId}/history`, await login('client1@email.com'))).status === 403);
// The notifications API is paginated (oldest first), so look through every page.
let notified = false;
for (let page = 1; page <= 20 && !notified; page++) {
  const notes = await call('GET', `/api/users/${client.id}/notifications?page=${page}`, client);
  notified = JSON.stringify(notes.body?.data ?? []).includes('Delivered');
  if (!notes.body?.pagination || page >= notes.body.pagination.totalPages) break;
}
check('customer notified (Delivered)', notified);
const dn = await call('GET', `/api/users/${d1.id}/notifications`, d1);
check('driver notified of assignment', dn.status === 200 && JSON.stringify(dn.body).includes('Nouvelle livraison'), `status=${dn.status}`);

// 7 pages (route guards and compilation)
const page = async (path, who) => (await fetch(`${BASE}${path}`, { redirect: 'manual', headers: { cookie: who?.cookie ?? '' } }));
const pAdmin = await page('/admin/deliveries', admin);
check('/admin/deliveries renders for admin', pAdmin.status === 200, `status=${pAdmin.status}`);
const pAdminAsClient = await page('/admin/deliveries', client);
check('/admin/deliveries redirects a customer', pAdminAsClient.status >= 300 && pAdminAsClient.status < 400, `status=${pAdminAsClient.status}`);
const pDriver = await page('/driver/deliveries', d1);
check('/driver/deliveries renders for driver', pDriver.status === 200, `status=${pDriver.status}`);
const pDriverAsClient = await page('/driver/deliveries', client);
check('/driver/deliveries redirects a customer', pDriverAsClient.status >= 300 && pDriverAsClient.status < 400, `status=${pDriverAsClient.status}`);
const pDriverAnon = await page('/driver/deliveries');
check('/driver/deliveries redirects anonymous to login', pDriverAnon.status >= 300 && pDriverAnon.status < 400 && (pDriverAnon.headers.get('location') ?? '').includes('/auth/login'));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
