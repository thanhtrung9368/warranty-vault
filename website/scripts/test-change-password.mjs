// Regression test for POST /api/v1/auth/change-password.
//
// Usage (assumes `npm run dev` or `npm run start` is already running on
// http://localhost:3000):
//
//   node scripts/test-change-password.mjs
//
// Equivalent curl flow this exercises:
//   1) curl -X POST :3000/api/v1/auth/login \
//        -H 'content-type: application/json' \
//        -d '{"email":"__pwtest__@local.test","password":"original-pw-12345"}'
//      → { accessToken, expiresAt, user }
//   2) curl -X POST :3000/api/v1/auth/change-password \
//        -H "authorization: Bearer $TOKEN" \
//        -H 'content-type: application/json' \
//        -d '{"currentPassword":"original-pw-12345",
//             "newPassword":"new-pw-67890",
//             "confirmPassword":"new-pw-67890"}'
//      → 200 { ok: true, message }
//
// Talks to the dev DB (uses DATABASE_URL from .env). Cleans up via cascade
// delete of the scoped test user (`__pwtest__@local.test`) so it's safe to
// re-run repeatedly.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt-ts';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL not set — copy .env.example to .env first.');
  process.exit(1);
}

const BASE = process.env.WV_BASE_URL ?? 'http://localhost:3000';
const TEST_EMAIL = '__pwtest__@local.test';
const ORIGINAL_PW = 'original-pw-12345';
const NEW_PW = 'new-pw-67890';

const adapter = new PrismaPg({ connectionString: DB_URL });
const prisma = new PrismaClient({ adapter });

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function cleanup() {
  const u = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (u) await prisma.user.delete({ where: { id: u.id } });
}

async function login(password) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password, platform: 'web' }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function changePassword(token, payload) {
  const res = await fetch(`${BASE}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function pingServer() {
  try {
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return res.status >= 200 && res.status < 600;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`→ Server check: ${BASE}`);
  if (!(await pingServer())) {
    throw new Error(
      `Server not reachable at ${BASE}. Start it with \`npm run dev\` (or \`npm run start\`) first.`,
    );
  }
  console.log('  ✓ server is up');

  console.log('→ Cleanup any prior test data');
  await cleanup();

  console.log('→ Seed test user');
  const passwordHash = await hash(ORIGINAL_PW, 12);
  await prisma.user.create({
    data: { email: TEST_EMAIL, passwordHash, name: 'PW Test' },
  });

  console.log('\n→ Login with original password');
  const loginRes = await login(ORIGINAL_PW);
  assert(loginRes.status === 200, `login returns 200 (got ${loginRes.status})`);
  assert(typeof loginRes.body.accessToken === 'string', 'response has accessToken');
  const token = loginRes.body.accessToken;

  console.log('\n→ Wrong currentPassword → 400 + fieldErrors');
  const wrongCurrent = await changePassword(token, {
    currentPassword: 'definitely-wrong',
    newPassword: NEW_PW,
    confirmPassword: NEW_PW,
  });
  assert(wrongCurrent.status === 400, `wrong-current returns 400 (got ${wrongCurrent.status})`);
  assert(wrongCurrent.body.error === 'bad_input', 'error code = bad_input');
  assert(
    Array.isArray(wrongCurrent.body.fieldErrors?.currentPassword),
    'fieldErrors.currentPassword present',
  );

  console.log('\n→ Mismatched confirm → 400 + fieldErrors.confirmPassword');
  const mismatched = await changePassword(token, {
    currentPassword: ORIGINAL_PW,
    newPassword: NEW_PW,
    confirmPassword: 'something-else-12345',
  });
  assert(mismatched.status === 400, `mismatch returns 400 (got ${mismatched.status})`);
  assert(
    Array.isArray(mismatched.body.fieldErrors?.confirmPassword),
    'fieldErrors.confirmPassword present',
  );

  console.log('\n→ Happy path: change to NEW_PW');
  const happy = await changePassword(token, {
    currentPassword: ORIGINAL_PW,
    newPassword: NEW_PW,
    confirmPassword: NEW_PW,
  });
  assert(happy.status === 200, `happy path returns 200 (got ${happy.status})`);
  assert(happy.body.ok === true, 'response.ok === true');

  console.log('\n→ Old password no longer works');
  const oldLogin = await login(ORIGINAL_PW);
  assert(oldLogin.status === 401, `old password login returns 401 (got ${oldLogin.status})`);

  console.log('\n→ New password works');
  const newLogin = await login(NEW_PW);
  assert(newLogin.status === 200, `new password login returns 200 (got ${newLogin.status})`);

  console.log('\n→ Unauthenticated request → 401');
  const noAuth = await fetch(`${BASE}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      currentPassword: NEW_PW,
      newPassword: 'whatever-12345',
      confirmPassword: 'whatever-12345',
    }),
  });
  assert(noAuth.status === 401, `unauthenticated returns 401 (got ${noAuth.status})`);

  console.log('\n→ Cleanup');
  await cleanup();
  console.log('\n✅ ALL CHANGE-PASSWORD TESTS PASSED');
}

main()
  .catch((e) => {
    console.error('\n❌ FAIL:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
