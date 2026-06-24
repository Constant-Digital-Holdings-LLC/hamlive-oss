<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/HL-main.svg">
    <img src="docs/HL-main-light.svg" alt="Ham.Live — Interactive Nets Made Easy" width="340">
  </picture>
</p>

<h1 align="center">Ham.Live (Open-Source Edition)</h1>

<p align="center"><strong>Self-hostable web app for running amateur radio nets.</strong></p>

Ham.Live is a browser-first application that helps amateur radio operators discover, join, and run
**nets** — coordinated on-air meetups where stations check in, exchange signal reports, and follow a
moderated agenda. This is the community open-source edition, intended to let clubs and groups run
their **own** instance.

> This repository is the MIT-licensed sister project to the original hosted Ham.Live service,
> shared for the amateur radio community to run and carry forward.

## Project status

Ham.Live is **released as-is for the community to self-host and carry forward.** It's the code that
powered the hosted Ham.Live service, which is winding down — I'm stepping back from day-to-day
operation, not taking on a support desk.

**What that means:**

- **No guaranteed support, SLAs, or maintenance.** Running an instance is do-it-yourself.
- **Issues and pull requests are welcome but handled on a best-effort, time-permitting basis** — they
  may not be answered or merged, so please don't expect a quick response.
- **Forks are encouraged.** If someone wants to drive this forward as a community maintainer, that's
  the goal — not a worst case.
- The MIT license already says it: provided **without warranty**. The same applies to support.

If your club depends on it, treat it like infrastructure you own: read the docs, keep your own
backups, and plan for self-reliance.

## Who's running it

Clubs and groups carrying Ham.Live forward on their own instances. If the hosted service was
your home, this is where the community is keeping it going.

- **[netcontrol.live](https://netcontrol.live)** — a public, community-hosted instance run by
  **Bucky (W0SUN)** and **Wayne (N0AD)**, who are putting real resources into keeping Ham.Live on
  the air. Open for any operator to join.
- **[N5SAC Ham Club](https://www.sachseraces.org/ham-chat/)** (Sachse, Texas) — standing up its own
  instance, "N5SAC Ham Chat," for their club nets.

Running an instance, or working on one? **[Open a pull request](CONTRIBUTING.md)** to add your
group here.

## Features

- **Real-time net participation** — live presence, ordered station lists, and interactions
  (hand, highlight, check-in/out, signal reports)
- **Net control (NCS) tools** — start/stop nets, assign roles, and run moderation via shell-style
  commands
- **Net discovery & following** — find active nets and follow the ones you care about
- **Real-time chat** (optional, via GetStream) with inline images
- **Email + Google sign-in** — magic-link email login, with optional Google OAuth
- **No front-end framework** — native ES modules, Custom Elements, and reactive stores

## Quick start (local test drive — no accounts needed)

You can run a fully working instance on your laptop with **zero paid accounts**. External services
(chat, email, callsign lookup, geocoding) are all optional and degrade gracefully when not
configured; magic sign-in links are printed to the server console.

```bash
git clone https://github.com/Constant-Digital-Holdings-LLC/hamlive-oss.git hamlive-oss
cd hamlive-oss
npm install
npm run dev
```

That's it — `npm run dev` creates your `.env` if needed, starts a local MongoDB automatically when
one isn't already running (no Docker required), and runs the app. Then open
**http://localhost:3000**, enter your email, and click the sign-in link that appears (when email
isn't configured, the link is shown right on the page). Stop everything with Ctrl+C.

> The auto-started MongoDB (`npm run mongo:dev` / the one embedded in `npm run dev`) is **in-memory
> and ephemeral** — data is lost when the process stops. For persistent data, use
> `docker compose up -d` before running `npm run dev` (see INSTALL.md).

👉 **Full instructions, OS-specific notes, and how to host for your club are in [INSTALL.md](INSTALL.md).**

## Technology

- **Backend:** Node.js + Express + EJS + MongoDB (Mongoose)
- **Frontend:** TypeScript ES modules, Custom Elements, reactive stores (no bundler)
- **Real-time:** Server-Sent Events with polling fallback
- **Auth:** magic-link email + optional Google OAuth, signed HTTP-only session cookies

## Documentation

New to running or joining nets? The app has a built-in **Guide** (top nav, or `/views/guide`) —
see [docs/user-guide.md](docs/user-guide.md) for what it covers.

Technical documentation lives in [`docs/`](docs/):

- [User guide](docs/user-guide.md) · [Net admin commands reference](docs/net-admin-commands-reference.md)
- [Architecture](docs/architecture.md) · [Server architecture](docs/server-architecture.md)
- [Database schema](docs/database-schema.md) · [Data model](docs/data-model.md)
- [SharedNetOps (domain logic)](docs/shared-net-ops.md) · [Controllers](docs/controllers.md)
- [Client framework](docs/client-framework.md) · [Views](docs/views.md)
- [SSE architecture](docs/sse-architecture.md) · [Chat system](docs/chat-system.md)
- [Authentication](docs/authentication.md) · [Security](docs/security.md)
- [Runtime config / feature flags](docs/runtime-config.md) · [Background jobs](docs/background-jobs.md)
- [API reference](docs/api-reference.md)

## Project layout

```
client/          # client TypeScript (src/) compiled to dist/ (served as static assets)
server/          # server code: dist/ runs in production, src/ holds the TypeScript being migrated
  dist/          # controllers, models, routes, lib, views (EJS), bin (CLI tools)
docs/            # technical documentation
scripts/         # setup helpers
docker-compose.yml
.env.example     # all configuration, documented
```

> **Note on source layout:** the project is partway through a JavaScript → TypeScript migration.
> Some server modules have TypeScript sources under `server/src`; the rest are maintained directly
> as JavaScript under `server/dist`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). The software is provided as-is. If you host an instance, you are responsible for
providing your own privacy policy and terms of use (placeholder pages are included for you to fill
in).
