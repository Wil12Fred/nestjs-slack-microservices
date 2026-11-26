# nestjs-slack-microservices

> Slack clone: NestJS microservices + React

A small Slack-style chat: **accounts** (tenants) contain **users**, users
create **workspaces**, workspaces contain **channels**, and messages posted to a
channel are pushed live to everyone in it over Socket.IO.

It was written in December 2023 as a short exercise in splitting a backend
into microservices. The project carries no data, hosts or code from any
company product.

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

| Package | What it does | Storage |
|---|---|---|
| `BACKEND/ms_auth` | Accounts, users, `POST /api/auth/login` (local strategy, bcrypt) issuing a JWT; `GET /api/auth/login` validates a token. Swagger at `/api/auth/docs`. | MySQL (Sequelize, tables auto-created) |
| `BACKEND/ms_admin` | Workspaces, channels and channel messages. Every request's bearer token is validated by calling ms_auth, and only a member of a workspace may read it, add users to it, or read, post to or create its channels (403 otherwise; 404 for a missing channel). A new message is stored and then put on the Bull queue `messages`. Swagger at `/api/docs`. | MySQL (TypeORM), Redis |
| `BACKEND/ms_socket` | Socket.IO gateway. A connection's `Authorization: Bearer <jwt>` is validated by calling ms_auth (rejected → disconnected). `register` joins the room named after a channel id only if ms_admin answers 200 to `GET /api/channel/<id>` with the client's own token; jobs from the `messages` queue are emitted to that room as `message`. | Redis |
| `FRONTEND/react_slack` | Login, user sign-up, workspace and channel menus, chat view. | browser `localStorage` (token) |
| `FRONTEND/test_script/SOCKET-CLIENT` | A tiny Node client to watch ms_socket events from the terminal. | — |

Multi-tenancy is by header: every request carries `account: <accountId>`.

### Who may see what

A workspace's members are its `user_workspaces` rows. The creator becomes a
member; any member can add another user. Membership is the only access rule,
and it is checked in one place, `WorkspaceService.assertMember` in ms_admin.
ms_socket does not decide membership itself: before letting a socket into a
channel's room it asks ms_admin for that channel with the socket's own token.
The JWT secret lives only in ms_auth; both ms_admin and ms_socket validate
tokens by calling `GET /api/auth/login`.

## Running locally

Requirements: Node 24 (what CI uses), MySQL 8 and Redis. With Docker,
`docker compose up -d` starts both, with the databases and user the
`.env.example` files expect.

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

## Tests and CI

```bash
npm run lint && npm run build && npm test        # any BACKEND/ms_* package
npm run build && npm test -- --watchAll=false    # FRONTEND/react_slack
```

The backend tests include the authorization rules: ms_admin's
`*.authorization.spec.ts` serve the real workspace and channel modules over
HTTP with in-memory repositories (member succeeds, non-member gets 403,
missing channel 404); ms_socket's specs mock ms_auth and ms_admin and check
that bad tokens disconnect, refused channels are not joined, and the app has
a single gateway instance. Nothing in CI needs MySQL, Redis or the other
services. The frontend tests cover the API route
builders and the `localStorage` helpers. `.github/workflows/ci.yml` runs
lint, build and test for all four packages.

## Known limitations

Security, still open:

- Access is checked when a socket connects and when it `register`s. A socket
  that has joined a room stays in it after its token expires or its user is
  removed from the workspace (there is no removal endpoint yet), until it
  disconnects.
- ms_auth's `PUT`, `GET` and `DELETE /api/users/:userId` need a valid token
  but not *that* user's token, so any logged-in user can read, change or
  delete any user. ms_auth was not part of the membership fix.
- `POST /api/workspace/:id/user` does not check that the invited user exists
  (users live in ms_auth, which ms_admin does not query) or belongs to the
  same account.
- The `account` header (and so `workspaces.accountId`) is client-supplied and
  enforced nowhere; membership, not the account, is what grants access.
- A missing channel answers 404 and someone else's channel 403, so channel ids
  can be probed. A missing workspace answers 403, like a foreign one.
- Errors that are not an explicit 403/404 (a failed database write, for
  example) still come back as 403 with a `status: 404` body, the services'
  original error mapping.

Other:

- `ms_admin` has no migrations; `TYPEORM_SYNCHRONIZE=true` creates its tables.
- The backend `npm run lint` script runs `eslint --fix`, so it rewrites files.

## Stack

NestJS 10, Sequelize, TypeORM, Bull, Socket.IO 4, Passport/JWT, Swagger;
React 17, Redux Toolkit, React Router 5, reactstrap/Bootstrap 5, Tailwind,
Sass. Styles and assets come from the "Dashonic" admin template by Pichforest.
