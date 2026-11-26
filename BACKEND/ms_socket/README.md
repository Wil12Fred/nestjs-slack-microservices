# ms_socket

Socket.IO gateway of [nestjs-slack-microservices](../../README.md). It relays
messages from the Bull queue `messages` (fed by ms_admin) to the room named
after each message's channel id.

## Who can connect and join

- **Connect**: the client must send `Authorization: Bearer <jwt>`. The gateway
  validates it by calling ms_auth (`GET ${AUTH_HOST}/api/auth/login`); any
  failure (no header, 401, an already expired token, ms_auth unreachable)
  disconnects the socket. The JWT secret stays in ms_auth. The validated user
  is kept on `client.data`.
- **Expiry**: ms_auth's answer carries the token's `exp`; the gateway
  disconnects the socket at that moment, which removes it from every room.
- **`register <channelId>`**: the gateway asks ms_admin for that channel with
  the client's own token (`GET ${ADMIN_HOST}/api/channel/<channelId>`). Only a
  200, i.e. the user is a member of the channel's workspace, joins the room;
  anything else answers `{ OK: false }`.

## Configuration

See `.env.example`. `AUTH_HOST` (base URL of ms_auth) and `ADMIN_HOST` (base
URL of ms_admin, without the `/api` prefix) are required: the config
validator stops the service at startup without them.

## Commands

```bash
npm ci
npm run lint
npm run build
npm test
npm run start:dev   # needs Redis and the two other services
```
