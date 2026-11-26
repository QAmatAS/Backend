// End-to-end check of the volunteer (NGO) API against a RUNNING server.
//
//   node scripts/smoke-volunteers.js                       (http://localhost:3000)
//   node scripts/smoke-volunteers.js https://ralwa.honeyotu.my.id
//
// Needs: Node 18+ and the demo accounts (npm run seed + npm run seed:admin).
// The KTP image is a tiny PNG built into this script. It registers two throw-away accounts (applicant and
// outsider) so it does not depend on, or disturb, the demo applications.
// Leftovers: two test users and one approved application named "Smoke ...".
// A valid 1x1 PNG, so the script needs no image file next to it.
const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function run(baseArg) {
  const base = String(baseArg || 'http://localhost:3000').replace(/\/+$/, '');
  const sample = SAMPLE_PNG;
  let pass = 0;
  let fail = 0;

  const check = (name, ok, detail) => {
    if (ok) pass += 1;
    else fail += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `   -> ${JSON.stringify(detail)}`}`);
  };

  async function call(method, url, token, { json, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    if (form) body = form;
    const res = await fetch(base + url, { method, headers, body });
    const buf = Buffer.from(await res.arrayBuffer());
    let parsed = null;
    try {
      parsed = JSON.parse(buf.toString());
    } catch {
      /* binary or empty body */
    }
    return { status: res.status, json: parsed, buf, headers: res.headers };
  }

  const form = (fields, { file = true, name = 'ktp.png', type = 'image/png', bytes = sample } = {}) => {
    const f = new FormData();
    if (fields !== null) f.append('data', typeof fields === 'string' ? fields : JSON.stringify(fields));
    if (file) f.append('ktp', new Blob([bytes], { type }), name);
    return f;
  };
  const message = (r) => (r.json && r.json.error && r.json.error.message) || '';
  const login = async (email, password) => (await call('POST', '/api/login', null, { json: { email, password } })).json;

  const health = await call('GET', '/api/health');
  check('server is up and the database is connected', health.status === 200 && health.json.db === 'connected', health.json);
  if (health.status !== 200) return false;

  const admin = await login('alice@example.com', 'password123');
  check('alice can log in (run npm run seed first)', admin && typeof admin.token === 'string');
  if (!admin || !admin.token) return false;
  const adminToken = admin.token;
  check('alice is an admin (run npm run seed:admin)', admin.user && admin.user.role === 'admin', admin.user && admin.user.role);

  const stamp = Date.now();
  const makeUser = async (label) => {
    const email = `smoke_${label}_${stamp}@example.com`;
    await call('POST', '/api/register', null, { json: { name: `Smoke ${label}`, email, password: 'secret123' } });
    return (await login(email, 'secret123')).token;
  };
  const applicant = await makeUser('applicant');
  const outsider = await makeUser('outsider');
  check('two throw-away accounts are ready', Boolean(applicant && outsider));
  if (!applicant || !outsider) return false;

  const good = { full_name: 'Smoke Pelamar', whatsapp: '0812-3456-7890', email: 'Smoke@Example.com' };
  const apply = (token, f) => call('POST', '/api/volunteers', token, { form: f });

  // --- applying
  let r = await apply(null, form(good));
  check('apply without token -> 401', r.status === 401, r.status);
  r = await apply(adminToken, form(good));
  check('admin applying -> 403', r.status === 403, r.status);
  r = await apply(applicant, form(good, { file: false }));
  check('missing ktp -> 400', r.status === 400, [r.status, message(r)]);
  r = await apply(applicant, form(good, { name: 'a.txt', type: 'text/plain', bytes: Buffer.from('halo') }));
  check('non-image ktp -> 400', r.status === 400, [r.status, message(r)]);
  r = await apply(applicant, form({ ...good, full_name: 123 }));
  check('full_name as a number -> 400 (not 500)', r.status === 400, [r.status, message(r)]);
  r = await apply(applicant, form('{bukan json'));
  check('data that is not JSON -> 400', r.status === 400, [r.status, message(r)]);
  r = await apply(applicant, form({ ...good, whatsapp: '123' }));
  check('whatsapp too short -> 400', r.status === 400, [r.status, message(r)]);
  r = await apply(applicant, form({ ...good, email: 'bukan-email' }));
  check('bad email -> 400', r.status === 400, [r.status, message(r)]);

  r = await apply(applicant, form(good));
  const mine = r.json && r.json.data;
  check('apply -> 201 pending', r.status === 201 && mine && mine.status === 'pending', [r.status, message(r)]);
  if (!mine) return false;
  check('whatsapp normalised to +62...', mine.whatsapp === '+6281234567890', mine.whatsapp);
  check('email lower-cased', mine.email === 'smoke@example.com', mine.email);
  check('response hides the stored file name', !JSON.stringify(r.json).includes('ktp_file') && mine.has_ktp === true);
  r = await apply(applicant, form(good));
  check('second application while pending -> 409', r.status === 409, [r.status, message(r)]);

  // --- reading
  r = await call('GET', '/api/volunteers/me', applicant);
  check('/me returns the pending application', r.status === 200 && r.json.data && r.json.data.volunteer_id === mine.volunteer_id, r.json);
  r = await call('GET', '/api/volunteers/me', outsider);
  check('/me without an application -> data null', r.status === 200 && r.json.data === null, r.json);
  r = await call('GET', '/api/volunteers', applicant);
  check('queue as contributor -> 403', r.status === 403, r.status);
  r = await call('GET', '/api/volunteers', adminToken);
  check('admin queue lists the application', r.status === 200 && r.json.data.some((v) => v.volunteer_id === mine.volunteer_id), r.status);
  check('queue has a summary', r.json && r.json.summary && typeof r.json.summary.pending === 'number');
  r = await call('GET', '/api/volunteers?status=bogus', adminToken);
  check('queue with invalid status -> 400', r.status === 400, r.status);

  // --- KTP privacy
  r = await call('GET', mine.ktp_url, applicant);
  check('owner downloads the KTP (same bytes)', r.status === 200 && Buffer.compare(r.buf, sample) === 0, r.status);
  check('KTP is not cacheable', /no-store/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
  r = await call('GET', mine.ktp_url, adminToken);
  check('admin downloads the KTP', r.status === 200, r.status);
  r = await call('GET', mine.ktp_url, outsider);
  check("someone else's KTP -> 404", r.status === 404, r.status);
  r = await call('GET', mine.ktp_url, null);
  check('KTP without token -> 401', r.status === 401, r.status);
  r = await call('GET', '/uploads/ktp/anything.png');
  check('KTP folder is not public under /uploads', r.status === 404, r.status);

  // --- review
  const review = (id, token, json) => call('PATCH', `/api/volunteers/${id}/review`, token, { json });
  r = await review(mine.volunteer_id, applicant, { decision: 'approved' });
  check('review as contributor -> 403', r.status === 403, r.status);
  r = await review(mine.volunteer_id, adminToken, { decision: 'maybe' });
  check('invalid decision -> 400', r.status === 400, r.status);
  r = await review(mine.volunteer_id, adminToken, { decision: 'rejected' });
  check('reject without a reason -> 400', r.status === 400, r.status);
  r = await review('vol_ffffffff', adminToken, { decision: 'approved' });
  check('unknown id -> 404', r.status === 404, r.status);
  r = await review(mine.volunteer_id, adminToken, { decision: 'rejected', reason: 'Foto KTP buram' });
  check('reject with reason -> 200', r.status === 200 && r.json.data.status === 'rejected' && r.json.data.review.rejection_reason === 'Foto KTP buram', [r.status, message(r)]);
  r = await review(mine.volunteer_id, adminToken, { decision: 'approved' });
  check('approve after reject -> 409', r.status === 409, r.status);
  r = await call('GET', '/api/volunteers/me', applicant);
  check('applicant sees the rejection reason', r.json.data && r.json.data.review.rejection_reason === 'Foto KTP buram', r.json);

  // --- re-apply + approve
  r = await apply(applicant, form({ ...good, full_name: 'Smoke Pelamar Baru' }));
  check('re-apply after rejection -> 201, same application, pending', r.status === 201 && r.json.data.volunteer_id === mine.volunteer_id && r.json.data.status === 'pending' && r.json.data.review.rejection_reason === null, [r.status, message(r)]);
  r = await call('GET', mine.ktp_url, applicant);
  check('KTP still downloadable after re-apply', r.status === 200, r.status);
  r = await review(mine.volunteer_id, adminToken, { decision: 'approved' });
  check('approve -> 200', r.status === 200 && r.json.data.status === 'approved', [r.status, message(r)]);
  r = await review(mine.volunteer_id, adminToken, { decision: 'approved' });
  check('approve again -> 200 (no-op)', r.status === 200 && r.json.data.status === 'approved', r.status);
  r = await apply(applicant, form(good));
  check('apply after approval -> 409', r.status === 409, [r.status, message(r)]);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  return fail === 0;
}

module.exports = { run };

if (require.main === module) {
  run(process.argv[2])
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('Smoke test crashed:', err.message);
      process.exit(2);
    });
}
