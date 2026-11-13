// Live check of Cloudflare R2 image storage against a RUNNING app (npm run dev).
// Needs R2_* and NEXT_PUBLIC_R2_PUBLIC_URL in .env and the seeded admin account.
// It uploads one 1x1 PNG (a few dozen bytes) through the real endpoint and fetches it back
// from the public URL. The object stays in your bucket under products/: delete it from
// the Cloudflare dashboard if you do not want it.
// Usage: node tests/live/r2-upload.mjs
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PW = process.env.TEST_PASSWORD ?? 'Test1234!';
const PUBLIC = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '').replace(/\/$/, '');
let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
};

if (!PUBLIC) {
  console.log('Set NEXT_PUBLIC_R2_PUBLIC_URL in your shell for this script, e.g.:');
  console.log('  NEXT_PUBLIC_R2_PUBLIC_URL=https://pub-xxxx.r2.dev node tests/live/r2-upload.mjs');
  process.exit(2);
}

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const upload = async (cookie, bytes, name, type, folder = 'products') => {
  const fd = new FormData();
  fd.append('file', new File([bytes], name, { type }));
  fd.append('folder', folder);
  const r = await fetch(`${BASE}/api/uploads/image`, { method: 'POST', headers: { cookie }, body: fd });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const admin = await login('admin@email.com');
const client = await login('client@email.com');

check('customer cannot upload (403)', (await upload(client, png, 'a.png', 'image/png')).status === 403);
check('anonymous cannot upload (401)', (await upload('', png, 'a.png', 'image/png')).status === 401);
check('a text file renamed .png is refused (400)', (await upload(admin, Buffer.from('not an image'), 'a.png', 'image/png')).status === 400);

const ok = await upload(admin, png, 'pixel.png', 'image/png');
check('admin upload accepted (200)', ok.status === 200, ok.status === 503 ? '(503: R2 is not configured on the server)' : `status=${ok.status}`);
if (ok.status === 200) {
  const key = ok.body.data.publicId;
  check('key is random and in the products folder', /^products\/[0-9a-f-]{36}\.png$/.test(key), key);
  const res = await fetch(`${PUBLIC}/${key}`);
  check('image is reachable at its public URL', res.status === 200, `status=${res.status}`);
  check('served as an image', (res.headers.get('content-type') ?? '').startsWith('image/png'), res.headers.get('content-type') ?? '');
  const bytes = Buffer.from(await res.arrayBuffer());
  check('bytes round-trip unchanged', bytes.equals(png));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
