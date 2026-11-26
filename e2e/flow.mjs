#!/usr/bin/env node
// End-to-end check of the sign-up -> workspace -> membership flow against a
// running ms_auth and ms_admin (real MySQL and Redis behind them). CI starts
// both services and runs this; locally:
//
//   AUTH_URL=http://localhost:3001 ADMIN_URL=http://localhost:3002 node e2e/flow.mjs
//
// Needs Node 18+ (global fetch). Exits non-zero on the first failed check.

const AUTH = process.env.AUTH_URL ?? 'http://localhost:3001';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3002';
const RUN = Date.now().toString(36); // unique names, so reruns do not clash
const PASSWORD = 'e2e-Pa55word';

let checks = 0;

function check(condition, what, detail) {
  checks += 1;
  if (!condition) {
    console.error(`FAIL ${what}`);
    if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
    process.exit(1);
  }
  console.log(`ok   ${what}`);
}

async function call(base, method, path, { token, account, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (account !== undefined) headers.account = String(account);
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text };
}

const hasHash = (text) => /"password"|\$2[aby]\$/.test(text);

// --- ms_auth: an account, two users, two logins --------------------------
const account = await call(AUTH, 'POST', '/accounts', {
  body: { name: `e2e-${RUN}`, description: 'e2e', type: 'PRODUCT', status: 'ACTIVE' },
});
check(account.status === 200, 'create an account', account.body);
const accountId = account.body.accountCreated.accountId;

async function signUp(username) {
  const res = await call(AUTH, 'POST', '/users', {
    account: accountId,
    body: {
      name: username,
      lastname: 'e2e',
      email: `${username}@example.test`,
      username,
      password: PASSWORD,
    },
  });
  check(res.status === 200, `sign up ${username}`, res.body);
  check(!hasHash(res.text), `sign-up response for ${username} has no password hash`, res.body);
  const login = await call(AUTH, 'POST', '/auth/login', {
    account: accountId,
    body: { grant_type: 'password', username, password: PASSWORD },
  });
  check(login.status === 201 && login.body.token?.accessToken, `log in ${username}`, login.body);
  check(!hasHash(login.text), `login response for ${username} has no password hash`, login.body);
  return { userId: res.body.userCreated.userId, token: login.body.token.accessToken };
}

const ana = await signUp(`ana${RUN}`);
const bob = await signUp(`bob${RUN}`);

const bobReadsAna = await call(AUTH, 'GET', `/users/${ana.userId}`, { token: bob.token });
check(
  bobReadsAna.status === 200 && bobReadsAna.body.email === undefined && !hasHash(bobReadsAna.text),
  "bob sees ana's public profile only",
  bobReadsAna.body,
);
const bobEditsAna = await call(AUTH, 'PUT', `/users/${ana.userId}`, {
  token: bob.token,
  account: accountId,
  body: { name: 'hacked' },
});
check(bobEditsAna.status === 403, 'bob cannot change ana', bobEditsAna.body);
const bobDeletesAna = await call(AUTH, 'DELETE', `/users/${ana.userId}`, { token: bob.token });
check(bobDeletesAna.status === 403, 'bob cannot delete ana', bobDeletesAna.body);

// --- ms_admin: a workspace and a channel, owned by ana -------------------
const ws = await call(ADMIN, 'POST', '/workspace', {
  token: ana.token,
  account: 999999, // ignored: the account comes from the token
  body: { name: `ws-${RUN}` },
});
check(ws.status === 200, 'ana creates a workspace', ws.body);
const workspaceId = ws.body.workspaceCreated.workspaceId;
check(
  Number(ws.body.workspaceCreated.accountId) === Number(accountId),
  "the workspace is in the token's account, not the header's",
  ws.body,
);

const channel = await call(ADMIN, 'POST', '/channel', {
  token: ana.token,
  body: { workspaceId, name: 'general' },
});
check(channel.status === 200, 'ana creates a channel', channel.body);
const channelId = channel.body.channelCreated.channelId;

// --- bob is not a member yet ---------------------------------------------
for (const [method, path, body] of [
  ['GET', `/workspace/${workspaceId}`],
  ['GET', `/channel/${channelId}`],
  ['POST', `/channel/${channelId}/message`, { text: 'let me in' }],
  ['POST', `/workspace/${workspaceId}/user`, { invitedUserId: bob.userId }],
]) {
  const res = await call(ADMIN, method, path, { token: bob.token, body });
  check(res.status === 403, `non-member bob: ${method} ${path} -> 403`, res.body);
}

// --- ana adds bob ----------------------------------------------------------
const ghost = await call(ADMIN, 'POST', `/workspace/${workspaceId}/user`, {
  token: ana.token,
  body: { invitedUserId: 987654321 },
});
check(ghost.status === 404, 'inviting a user that does not exist -> 404', ghost.body);

const added = await call(ADMIN, 'POST', `/workspace/${workspaceId}/user`, {
  token: ana.token,
  body: { invitedUserId: bob.userId },
});
check(added.status === 200, 'ana adds bob to the workspace', added.body);

// --- bob, now a member, reads and posts ----------------------------------
const bobWs = await call(ADMIN, 'GET', `/workspace/${workspaceId}`, { token: bob.token });
check(bobWs.status === 200 && bobWs.body.workspaceId === workspaceId, 'member bob reads the workspace', bobWs.body);

const posted = await call(ADMIN, 'POST', `/channel/${channelId}/message`, {
  token: bob.token,
  body: { text: `hello from bob ${RUN}` },
});
check(posted.status === 200, 'member bob posts a message', posted.body);

const read = await call(ADMIN, 'GET', `/channel/${channelId}`, { token: bob.token });
const texts = (read.body?.channelMessages ?? []).map((cm) => cm.message?.text);
check(
  read.status === 200 && texts.includes(`hello from bob ${RUN}`),
  'member bob reads the channel and sees his message',
  read.body,
);

const list = await call(ADMIN, 'GET', '/workspace', { token: bob.token });
check(
  list.status === 200 && list.body.some((w) => w.workspaceId === workspaceId),
  "the workspace is in bob's list",
  list.body,
);

console.log(`\nall ${checks} checks passed`);
