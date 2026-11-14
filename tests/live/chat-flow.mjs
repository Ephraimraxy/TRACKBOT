// Live check of the chatbot against a RUNNING app (npm run dev) seeded with `npm run seed:demo`.
// With no AI keys in .env this exercises the rule-based mode; with keys it exercises the AI path.
// Usage: node tests/live/chat-flow.mjs
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PW = process.env.TEST_PASSWORD ?? 'Test1234!';
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
  return { cookie, id: s.user?.id };
}
async function api(method, path, who, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: who?.cookie ?? '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const chat = (who, message, history = []) => api('POST', '/api/chat', who, { message, history });

const client = await login('client@email.com');
const other = await login('client1@email.com');
const admin = await login('admin@email.com');
const driver = await login('livreur1@email.com');

// A catalogue product to ask about (real price/stock from the API itself).
const prod = (await api('GET', '/api/products?pageSize=1')).body.data[0];
const word = prod.nom.split(/\s+/)[0];

// 1 anonymous product question: real price must appear
let r = await chat(null, `prix ${word}`);
check('anonymous product question answered', r.status === 200 && typeof r.body.reply === 'string', `source=${r.body?.source}`);
check('reply contains the real price', r.body.reply.includes(String(Number(prod.prix))), `(expected ${Number(prod.prix)})`);
check('a search tool was used', r.body.usedTools.includes('search_products'));

// 2 anonymous order question: asked to log in, no order data
r = await chat(null, 'où est ma commande ?');
check('anonymous order question asks for login', /connecter|log in/i.test(r.body.reply));

// 3 a customer with an order: place one, advance it, ask the bot
const place = await api('POST', '/api/orders', client, {
  userId: client.id,
  addresse: { rue: '9 Rue Chat', ville: 'Keffi', wilaya: 'Nasarawa', codePostal: '961101' },
  produits: [{ produitId: prod.id, quantite: 1 }],
});
const orderId = place.body.data.id;
const ref = orderId.slice(-8);
await api('PATCH', `/api/orders/${orderId}/status`, admin, { statut: 'EN_PREPARATION' });
await api('PATCH', `/api/orders/${orderId}/status`, admin, { statut: 'EXPEDIEE' });
await api('POST', `/api/orders/${orderId}/assign`, admin, { driverId: driver.id });
await api('PATCH', `/api/delivery/orders/${orderId}/status`, driver, { statut: 'EN_LIVRAISON' });

r = await chat(client, 'where is my order?');
check('customer gets the real status of the latest order', r.body.reply.includes(ref) && /out for delivery/i.test(r.body.reply), `source=${r.body.source}`);
check('order tool used', r.body.usedTools.includes('track_my_order'));

// 4 another customer cannot learn about this order
r = await chat(other, `where is my order #${ref}`);
check("another customer cannot see it", !r.body.reply.includes('Out for delivery') && /can't find|introuvable|ne trouve/i.test(r.body.reply));
r = await chat(other, 'my orders');
check("other customer's list does not include it", !r.body.reply.includes(ref));

// 5 the owner is not treated as a customer: they get the shop overview, never a customer's order list
r = await chat(admin, 'where is my order?');
check('admin gets the owner overview (shop_overview tool), not customer tools', r.body.usedTools.includes('shop_overview') && !r.body.usedTools.includes('list_my_orders'));

// 6 forged identity in the body is ignored
r = await api('POST', '/api/chat', other, { message: 'where is my order?', userId: client.id });
check('forged userId in body is ignored', r.status === 200 && !r.body.reply.includes(ref));

// 7 validation + shape
check('empty message -> 400', (await chat(null, '')).status === 400);
check('too long -> 400', (await chat(null, 'x'.repeat(501))).status === 400);
check('response exposes only reply/source/usedTools', JSON.stringify(Object.keys(r.body).sort()) === JSON.stringify(['reply', 'source', 'usedTools']));

// 8 history is accepted
r = await chat(null, 'et le prix ?', [{ role: 'user', content: `prix ${word}` }, { role: 'assistant', content: 'ok' }]);
check('history accepted', r.status === 200);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
