# Installing Ham.Live (Open-Source Edition)

This guide covers two paths:

1. **[Local test drive](#1-local-test-drive)** — run it on your own machine with **zero accounts**,
   to try it out or develop against it. Works on **Windows, macOS, and Linux**.
2. **[Hosting for your club](#2-hosting-for-your-club)** — stand up a real instance, including the
   external accounts you'll want for email, chat, and lookups.

---

## Prerequisites

| Tool               | Version                                                  | Notes                                                                   |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Node.js**        | 18 LTS or newer                                          | <https://nodejs.org>                                                    |
| **MongoDB**        | 6 or newer (bundled `docker-compose.yml` uses `mongo:7`) | Local via Docker (recommended) or a managed database                    |
| **Git**            | any                                                      | to clone the repository                                                 |
| **Docker Desktop** | optional                                                 | easiest way to run MongoDB locally                                      |
| **OpenSSL**        | optional                                                 | only if you opt into local HTTPS (`HTTPS=true`) and regenerate the cert |

### OS-specific setup

**Windows**

- Install Node.js (the MSI from nodejs.org) and [Docker Desktop](https://www.docker.com/products/docker-desktop/).
- Use **PowerShell** or **Git Bash**. All `npm run` scripts in this project are cross-platform.
- A throwaway dev TLS certificate is included, so OpenSSL is not required.

**macOS**

- `brew install node` and install Docker Desktop (or `brew install mongodb-community` to run Mongo natively).

**Linux**

- Install Node.js (via your distro or [nodesource](https://github.com/nodesource/distributions))
  and Docker Engine + the Compose plugin (or install `mongodb` natively).

---

## 1. Local test drive

A complete, working instance with **no paid accounts**. Every external integration is optional and
disables itself cleanly when its keys are absent. Email login still works because magic sign-in
links are **printed to the server console**.

```bash
git clone https://github.com/Constant-Digital-Holdings-LLC/hamlive-oss.git hamlive-oss
cd hamlive-oss

npm install              # install dependencies
npm run dev              # does everything (see below)
```

`npm run dev` is all you need for a local run. It automatically:

- creates your `.env` from `.env.example` (so you don't have to run `npm run setup`),
- starts a local MongoDB if one isn't already running — **no Docker required** (it downloads a
  `mongod` binary on first run, which can take a minute; if you already have MongoDB running via
  Docker, natively, or pointing at a remote/Atlas URI, it detects and uses that instead), and
- compiles the TypeScript and runs the app.

Stop everything with **Ctrl+C**.

Now:

1. Open **http://localhost:3000** (plain HTTP on localhost — no certificate warning).
2. Enter any email address and submit the email sign-in form.
3. Because email delivery isn't configured, the page shows a **"Click here to finish signing in →"**
   button — click it. (The link is also printed in the `npm run dev` terminal if you prefer.)
4. You're logged in. Set your callsign on the account page and you can create and run a net.

> Prefer HTTPS locally? Set `HTTPS=true` (and `BASE_URL=https://localhost:3000`) to serve dev over
> HTTPS with a bundled self-signed cert — your browser will then show the usual "not private" warning
> for self-signed certs, which you can click through.

**What's disabled in this mode** (all optional): Google sign-in button is hidden, real-time chat is
off, and QRZ callsign / location enrichment is skipped. Add the relevant keys (below) to enable them.

### MongoDB options

You don't have to do anything — `npm run dev` starts a local MongoDB for you when none is running.
If you'd rather manage MongoDB yourself (for example, to keep your data across app restarts), use
any one of these and `npm run dev` will detect and use it:

**Bundled helper, separate terminal** (no Docker, no install, no sudo):

```bash
npm run mongo:dev        # terminal 1 — leave running (single-node replica set on :27017)
npm run dev              # terminal 2 — the app
```

> **Note:** `npm run mongo:dev` uses `mongodb-memory-server` — data is **in-memory and ephemeral**.
> Everything is lost when the process stops (Ctrl+C). The first run downloads a `mongod` binary,
> which can take a minute.

**Docker** (persistent data): `docker compose up -d` — uses the bundled `docker-compose.yml` (`mongo:7`,
single-node replica set, named volume — data persists across restarts).

**Native install** — install MongoDB Community Server and point the app at it:

- Install MongoDB Community Server for your OS.
- Real-time updates use **change streams**, which require a **replica set** (not a standalone
  `mongod`). Start it as a single-node replica set and initiate it once:
    ```bash
    mongod --replSet rs0 --dbpath /your/data/dir
    # in another shell, once:
    mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
    ```
- Keep the default `MONGODB_URI=mongodb://localhost:27017/hamlive?directConnection=true` in `.env`
  (the `directConnection=true` flag is what lets the driver talk to a single-node replica set).

### Stopping / resetting

If you started MongoDB with `docker compose up -d`:

```bash
docker compose down          # stop MongoDB (data persists in the named volume)
docker compose down -v       # stop MongoDB and delete all local data
```

If you are using the in-memory helper (`npm run mongo:dev`) or the auto-started MongoDB inside
`npm run dev`, simply press **Ctrl+C** — the process (and all data) stops cleanly.

---

## 2. Hosting for your club

To run a shared instance, you'll set environment variables (no secrets live in the code or the
committed config). Copy `.env.example` to `.env` (or set real environment variables on your host)
and fill in the values below.

### Required

| Variable             | What it is                                                    |
| -------------------- | ------------------------------------------------------------- |
| `NODE_ENV`           | `production` for a hosted instance                            |
| `BASE_URL`           | Public URL of your instance, e.g. `https://nets.yourclub.org` |
| `MONGODB_URI`        | Connection string to your MongoDB                             |
| `COOKIE_SESSION_KEY` | Long random string used to sign session cookies               |
| `MAGIC_LINK_SECRET`  | Long random string used to sign email login tokens            |
| `PORT`               | Port to listen on (your platform may set this)                |

Generate strong secrets, for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Optional integrations and the accounts they need

Each integration is independent — enable only what you want.

| Integration                          | Account / where to sign up                          | Variables                                  | Free tier?            |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------------ | --------------------- |
| **MongoDB Atlas** (database hosting) | <https://www.mongodb.com/atlas>                     | `MONGODB_URI`                              | Yes (M0)              |
| **Email delivery** (ZeptoMail)       | <https://www.zoho.com/zeptomail/>                   | `ZEPTOMAIL_API_KEY`, `EMAIL_FROM`          | Paid / trial varies   |
| **Email delivery** (SendGrid)        | <https://sendgrid.com>                              | `SENDGRID_API_KEY`, `EMAIL_FROM`           | Limited free tier     |
| **Google sign-in** (OAuth)           | <https://console.cloud.google.com/apis/credentials> | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Yes                   |
| **Real-time chat** (GetStream)       | <https://getstream.io>                              | `STREAM_API_KEY`, `STREAM_API_SECRET`      | Yes (maker plan)      |
| **Callsign lookup** (QRZ.com)        | <https://www.qrz.com/page/xml_data.html>            | `QRZ_USERNAME`, `QRZ_PASSWORD`             | Paid XML subscription |
| **Reverse geocoding** (Azure Maps)   | <https://azure.microsoft.com/products/azure-maps>   | `GEO_KEY`                                  | Yes (limited)         |

Notes:

- **Email:** without ZeptoMail or SendGrid configuration, login links are logged to the server
  console (fine for testing, **not** for a real instance). `EMAIL_FROM` must be a sender you've
  verified with your email provider. ZeptoMail is used when both `ZEPTOMAIL_API_KEY` and
  `EMAIL_FROM` are set; if both ZeptoMail and SendGrid are configured, ZeptoMail wins. SendGrid is
  still supported with `SENDGRID_API_KEY`.
- **Google OAuth:** set the authorized redirect URI to `${BASE_URL}/auth/google/redirect`.
- **Chat:** without GetStream keys, the chat panel is simply absent; nets work without it.
- **Ads & analytics:** **disabled by default** in the community edition. To enable, set
  `ADS_ENABLED=true` / `ANALYTICS_ENABLED=true` **and** supply your own provider IDs
  (`ADPLUGG_ACCESS_CODE` / `GOOGLE_ANALYTICS_ID`). Each stays off unless both its flag and ID are set.

### Build and run

```bash
npm install
npm run build            # compile TypeScript sources (required before starting)
NODE_ENV=production npm start
```

### Hosting platform & TLS

The app is a standard Node/Express server with no platform lock-in — it runs anywhere Node runs:
Render, Fly.io, Railway, a plain VPS, etc. A `Procfile` (`web: npm start`) is included for platforms
that use it, but it's optional; `npm start` works everywhere.

In production the app listens on plain HTTP and expects **TLS to be terminated by your platform or a
reverse proxy** (nginx, Caddy, a cloud load balancer, etc.). Point the proxy at the app's `PORT` and
set `BASE_URL` to the public HTTPS URL. To force HTTP→HTTPS redirects at the app, set
`FORCE_HTTPS=true` (uses the standard `x-forwarded-proto` header). If your proxy drops idle
connections sooner/later than ~55s, tune `SSE_IDLE_TIMEOUT_MS` so real-time keep-alives fit inside
it. (In development the app serves plain HTTP on localhost by default — no certificate warning. Set
`HTTPS=true` to serve dev over HTTPS with the bundled self-signed cert; `npm run gen-certs`
regenerates it.)

### Legal pages

The privacy policy, terms of use, and cookie policy ship as **placeholders**
(`server/dist/views/privacyPolicy.ejs`, `termsOfUse.ejs`, `cookiePolicy.ejs`). Replace them with
documents appropriate to your instance and jurisdiction before going live.

### Backups

A backup/restore/migrate CLI is included at `server/dist/bin/dbBackup.js` (it shells out to
`mongodump`/`mongorestore`). See [docs/runbook.md](docs/runbook.md) for operational procedures.

---

## Troubleshooting

| Symptom                                                         | Fix                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Your connection is not private" / `ERR_CERT_AUTHORITY_INVALID` | You're on `https://localhost` with the self-signed dev cert. Use **http://localhost:3000** (the default), or keep HTTPS and click through the warning.                                                |
| `MongooseServerSelectionError`                                  | MongoDB isn't running / `MONGODB_URI` is wrong. Start `docker compose up -d` or check the URI. With Docker, give it ~20s on first start to initiate the replica set.                                  |
| `$changeStream stage is only supported on replica sets`         | Your MongoDB is a standalone, not a replica set. Use the bundled `docker compose` (already a replica set) or start native `mongod` with `--replSet` as shown above.                                   |
| No login email arrives                                          | Expected in local mode — the link is printed to the server console. For hosted instances, set `ZEPTOMAIL_API_KEY` and a verified `EMAIL_FROM`, or set `SENDGRID_API_KEY` and a verified `EMAIL_FROM`. |
| Google button missing                                           | Google OAuth isn't configured. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.                                                                                                                       |
| Chat panel missing                                              | GetStream isn't configured. Set `STREAM_API_KEY` / `STREAM_API_SECRET`.                                                                                                                               |

More background is in [`docs/`](docs/), starting with
[docs/developer-setup.md](docs/developer-setup.md) and [docs/runbook.md](docs/runbook.md).
