# nestjs-slack-microservices

[![CI](https://github.com/Wil12Fred/nestjs-slack-microservices/actions/workflows/ci.yml/badge.svg)](https://github.com/Wil12Fred/nestjs-slack-microservices/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A small Slack clone split into three NestJS microservices (auth, admin,
Socket.IO) and a React client: accounts (tenants) contain users, users create
workspaces, workspaces contain channels, and a message posted to a channel is
pushed live to everyone in it. The interesting part is how the services trust
each other: only ms_auth holds the JWT secret, and every other service asks it.

## Features

- **ms_auth** — accounts, sign-up, login (Passport local strategy + bcrypt)
  issuing a JWT, and `GET /api/auth/login` that validates a token for the
  other services. Swagger at `/api/auth/docs`.
- **ms_admin** — workspaces, channels and messages over REST; a new message is
  stored in MySQL and queued on Redis (Bull queue `messages`). Swagger at
  `/api/docs`.
- **ms_socket** — Socket.IO gateway: authenticates each connection through
  ms_auth, lets a socket join a channel's room only if ms_admin says it may
  see that channel, and emits queued messages to that room.
- **react_slack** — login, sign-up, workspace and channel menus, chat view.
- Workspace-membership authorization end to end (REST and sockets), see
  [Security model](#security-model).
- `docker-compose.yml` for the MySQL and Redis the services need.

## Architecture

```
                 ┌──────────────────────┐
                 │ FRONTEND/react_slack │  React 17 + Redux Toolkit + reactstrap
                 └──┬────────┬───────┬──┘
           REST     │        │ REST  │ Socket.IO
                    ▼        ▼       ▼
   ┌──────────────────┐ ┌──────────────────┐   ┌──────────────────┐
   │ ms_auth  :3001   │◄┤ ms_admin  :3002  │   │ ms_socket  :5300 │
   │ accounts, users, │ │ workspaces,      │   │ Socket.IO rooms  │
   │ login (JWT)      │ │ channels,        │   │ = channel ids    │
   │ Sequelize        │ │ messages         │   │                  │
   └────────┬─────────┘ │ TypeORM          │   └────────▲─────────┘
            │           └───┬─────────┬────┘            │
            ▼               ▼         │  Bull queue      │
       MySQL slack_auth  MySQL        └──"messages"──► Redis
                         slack_admin
```

ms_admin and ms_socket also call ms_auth (token validation, user lookup), and
ms_socket calls ms_admin (channel access); those arrows are left out above.

| Package | What it does | Storage |
|---|---|---|
| `BACKEND/ms_auth` | Accounts, users, `POST /api/auth/login` issuing a JWT; `GET /api/auth/login` validates a token and returns its payload (`userId`, `accountId`, `username`, `email`, `exp`). | MySQL (Sequelize, tables auto-created) |
| `BACKEND/ms_admin` | Workspaces, channels and channel messages. Every request's bearer token is validated by calling ms_auth. | MySQL (TypeORM), Redis |
| `BACKEND/ms_socket` | Socket.IO gateway; see [its README](BACKEND/ms_socket/README.md). | Redis |
| `FRONTEND/react_slack` | The web client. | browser `localStorage` (token) |
| `FRONTEND/test_script/SOCKET-CLIENT` | A tiny Node client to watch ms_socket events from the terminal. | — |

### Security model

**Identity** comes only from the JWT, validated by ms_auth. The token carries
the `accountId` the user logged into; that, never the `account` request
header, decides which account a request acts in.

**Users (ms_auth).**
- `PUT` and `DELETE /api/users/:userId` need that user's own token (403
  otherwise); `PUT` changes only `name` and `lastname`.
- `GET /api/users/:userId` returns yourself in full, another user of your
  account as a public profile (`userId`, `name`, `lastname`, `username`), and
  404 for anyone else, exactly as for a user that does not exist.
- `GET /api/users` lists your account's users the same way.
- No endpoint returns a password or its hash: `Users.toJSON` drops it, so
  every serialisation path (sign-up, login, user reads) is covered.

**Workspaces (ms_admin).** A workspace's members are its `user_workspaces`
rows; the creator becomes a member and any member can add another user. The
rule lives in one place, `WorkspaceService.assertMember`: a user may see a
workspace, add users to it, or read, post to or create its channels only if
they are a member *and* their token is for the workspace's account (403
otherwise; 404 for a missing channel). Adding a user asks ms_auth for that
user with the caller's own token: 404 if ms_auth does not show them, which
covers users that do not exist and users of other accounts. A new workspace
is stamped with the token's account.

**Sockets (ms_socket).** A connection must carry a token ms_auth accepts; it
is disconnected when that token expires. `register <channelId>` joins the
room only if ms_admin answers 200 to `GET /api/channel/<id>` with the
socket's own token.

**The `account` header** is still sent by the frontend and still read in two
places where it is harmless: sign-up (`POST /api/users`, which account to
create the user in) and login (`POST /api/auth/login`, which account to log
into — the credentials are checked inside that account, and the resulting
token is bound to it). Everywhere else it is ignored.

**Errors.** A deliberate 400/401/403/404 is returned as such; anything else
(a failed database write, ms_auth unreachable during an invite) is a 500.

## Requirements

- Node.js 24 and npm (what CI uses).
  Debian/Ubuntu: `nodejs npm` (or NodeSource for 24). Arch: `nodejs npm`.
- MySQL 8 and Redis 7. With Docker, `docker compose up -d` starts both, with
  the databases and user the `.env.example` files expect.
  Debian/Ubuntu: `docker.io docker-compose-v2` (or `mysql-server redis-server`
  on Ubuntu). Arch: `docker docker-compose` (or `redis` plus MySQL from the
  AUR; MariaDB from `mariadb` is untested).

## Build

Each package is built on its own:

```bash
cd BACKEND/ms_auth      && npm ci && npm run build   # likewise ms_admin, ms_socket
cd FRONTEND/react_slack && npm ci && npm run build
```

## Run

```bash
# 1. infrastructure
docker compose up -d            # or your own MySQL + Redis

# 2. each service, in its own terminal
cd BACKEND/ms_auth   && cp .env.example .env && npm ci && npm run start:dev
cd BACKEND/ms_admin  && cp .env.example .env && npm ci && npm run start:dev
cd BACKEND/ms_socket && cp .env.example .env && npm ci && npm run start:dev

# 3. create the first account (tenant); its id goes in REACT_APP_ACCOUNT
curl -X POST http://localhost:3001/api/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name":"demo","description":"demo account","type":"PRODUCT","status":"ACTIVE"}'

# 4. frontend
cd FRONTEND/react_slack && cp .env.example .env && npm ci && npm start
```

Then sign up a user from the login page, log in, and create a workspace and a
channel.

With ms_auth and ms_admin running, `node e2e/flow.mjs` walks the whole flow
over HTTP (`AUTH_URL`/`ADMIN_URL` override the default `localhost:3001` and
`:3002`). This is its output from CI, against MySQL 8 and Redis:

```
$ AUTH_URL=http://127.0.0.1:3001 ADMIN_URL=http://127.0.0.1:3002 node e2e/flow.mjs
ok   create an account
ok   sign up anamwx3p9uu
ok   sign-up response for anamwx3p9uu has no password hash
ok   log in anamwx3p9uu
ok   login response for anamwx3p9uu has no password hash
ok   sign up bobmwx3p9uu
ok   sign-up response for bobmwx3p9uu has no password hash
ok   log in bobmwx3p9uu
ok   login response for bobmwx3p9uu has no password hash
ok   bob sees ana's public profile only
ok   bob cannot change ana
ok   bob cannot delete ana
ok   ana creates a workspace
ok   the workspace is in the token's account, not the header's
ok   ana creates a channel
ok   non-member bob: GET /workspace/1 -> 403
ok   non-member bob: GET /channel/1 -> 403
ok   non-member bob: POST /channel/1/message -> 403
ok   non-member bob: POST /workspace/1/user -> 403
ok   inviting a user that does not exist -> 404
ok   ana adds bob to the workspace
ok   member bob reads the workspace
ok   member bob posts a message
ok   member bob reads the channel and sees his message
ok   the workspace is in bob's list

all 25 checks passed
```

To watch the socket side alone: `cd FRONTEND/test_script/SOCKET-CLIENT && npm
install && node client.js` connects to `localhost:5300` and joins room `10`.

### Environment variables

Every variable each package reads is listed, with placeholder values, in its
`.env.example`:

- `BACKEND/ms_auth/.env.example` — `PORT`, `MYSQ_DB_*` (sic), `JWT_SECRET_KEY`, `JWT_EXPIRATION_TIME`
- `BACKEND/ms_admin/.env.example` — `PORT`, `AUTH_HOST`, `REDIS_HOST`/`REDIS_PORT`, `TYPEORM_*`
- `BACKEND/ms_socket/.env.example` — `APP_PORT`, `REDIS_HOST`/`REDIS_PORT`, `CACHE_TTL`, `AUTH_HOST` (ms_auth), `ADMIN_HOST` (ms_admin); the last two are required and ms_socket refuses to start without them
- `FRONTEND/react_slack/.env.example` — `REACT_APP_API_AUTH_ENDPOINT`, `REACT_APP_API_ADMIN_ENDPOINT`, `REACT_APP_SOCKET_HOST`/`_PORT`, `REACT_APP_ACCOUNT`

`ms_admin` picks its env file from `NODE_ENV`: `.env` (default or `dev`),
`.stag.env`, `.prod.env`.

## Tests

In every package:

```bash
npm run lint && npm run build && npm test    # CI=true for the frontend
```

- **ms_auth** — `users.authorization.spec.ts` serves the real users, auth and
  accounts modules over HTTP on an in-memory SQLite database
  (`test/support/auth-app.ts`; users are created and logged in through the
  API): self-only `PUT`/`DELETE`, account-scoped and public-profile reads,
  the header being ignored, no password hash in any response, 500 for a
  failed write.
- **ms_admin** — `*.authorization.spec.ts` serve the real workspace and
  channel modules over HTTP with in-memory repositories and a fake ms_auth
  (`test/support/membership-app.ts`): member succeeds, non-member 403,
  missing channel 404, another account's workspace 403, invitee unknown to
  ms_auth 404, the token's account stamped on new workspaces, 500 for
  storage failures. `auth.provider.spec.ts` covers how ms_auth's answers map.
- **ms_socket** — the gateway spec mocks ms_auth and ms_admin: bad tokens
  disconnect, refused channels are not joined, sockets are disconnected when
  their token expires (fake timers); the wiring spec boots the app module
  and checks there is a single gateway instance.
- **react_slack** — reducers (auth, user data, layout), the API route
  builders and the `localStorage` helpers.
- **e2e** — the `e2e` job in `.github/workflows/ci.yml` starts MySQL 8 and
  Redis as service containers, boots ms_auth and ms_admin from their builds
  and runs `e2e/flow.mjs` (see [Run](#run)).

## Project layout

```
BACKEND/
  ms_auth/      src/{accounts,auth,users}               test/support/auth-app.ts
  ms_admin/     src/{workspace,channel,message,auth}    test/support/membership-app.ts
  ms_socket/    src/{events,messages,auth,admin}
FRONTEND/
  react_slack/  src/{components,hooks,slices,config,utility}
  test_script/SOCKET-CLIENT/   terminal Socket.IO client
e2e/flow.mjs    end-to-end HTTP flow, run in CI
docker/         MySQL init script (docker compose and CI)
.github/workflows/ci.yml
```

## Known limitations

Security, still open:

- A socket keeps the rooms it joined until its token expires or it
  disconnects, even if its user loses the membership meanwhile. There is no
  endpoint to remove a member yet, so this only matters for rows deleted by
  hand; closing it would mean re-checking membership per delivered message.
- A missing channel answers 404 and someone else's channel 403, so channel
  ids can be probed. A missing workspace answers 403, like a foreign one.
- `POST /api/accounts` is open: anyone can create an account (tenant). It is
  how the first account is made.
- ms_admin answers 403 when ms_auth cannot be reached to validate a token,
  the same as for a bad token.
- Membership rows that predate the account check (a user of another account
  added to a workspace) are not deleted; they are just no longer honoured.

Other:

- `ms_admin` has no migrations; `TYPEORM_SYNCHRONIZE=true` creates its tables.
- Every login also calls `encyptPassword`, which hashes the given password
  and tries to store it in a `secret` column the model does not have. It is
  dead weight, not a leak.
- The frontend is Create React App 5 (`react-scripts`, no longer maintained)
  on React 17.

## Background

Written in December 2023 as a short exercise in splitting a backend into
microservices. It carries no data, hosts or code from any company product.
Styles and assets come from the "Dashonic" admin template by Pichforest.
Stack: NestJS 10, Sequelize, TypeORM, Bull, Socket.IO 4, Passport/JWT,
Swagger; React 17, Redux Toolkit, React Router 5, reactstrap/Bootstrap 5,
Tailwind, Sass.

## License

MIT — see [LICENSE](LICENSE).
