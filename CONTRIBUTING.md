# Contributing to Ham.Live (Open-Source Edition)

Thanks for your interest in improving Ham.Live!

> **Project status — please read first.** Ham.Live is released as-is for the community to carry
> forward. The original author is stepping back, so issues and pull requests are reviewed
> **best-effort, as time permits** — they may not be answered or merged quickly (or at all).
> Contributions are genuinely welcome, and **forking to maintain your own line is encouraged.**
> See the README's [Project status](README.md#project-status) for the full picture. Smaller,
> focused PRs have the best chance of being reviewed and merged.

## Getting set up

Follow the [Local test drive](INSTALL.md#1-local-test-drive) in `INSTALL.md`. In short:

```bash
npm install
npm run dev
```

`npm run dev` does everything: it creates `.env` from `.env.example` if it doesn't exist yet,
starts a local in-memory MongoDB automatically (no Docker required), and then runs `nodemon` with
TypeScript watchers so both `client/src/` and the four `server/src/` files recompile on change.

If you want data to persist across restarts, start `docker compose up -d` (persistent named
volume) **before** `npm run dev` — it will detect and use that instance instead of starting its
own.

## Source layout — please read

The project is **partway through a JavaScript → TypeScript migration**:

- Exactly **four server-side TypeScript files** live under `server/src/lib/`:
  `realtimeClients.ts`, `responseUtils.ts`, `secureSign.ts`, and `streamChat.ts`. These compile
  into `server/dist/lib/` via `npm run build` (or the watcher inside `npm run dev`).
- The **majority** of the server (controllers, models, routes, `sharedNetOps`, most of `lib`) is
  currently maintained **directly as JavaScript in `server/dist`** — there is no separate TS source
  for those files yet.

What this means for you:

- If a file exists under `server/src`, **edit the TypeScript** there and let the build regenerate the
  `dist` output. Don't hand-edit the generated `dist` copy of a file that has a `src` twin.
- If a file exists **only** in `server/dist`, edit it there directly — that JavaScript is the source
  of truth until it is migrated.
- The **client** is TypeScript-first: edit under `client/src`; `client/dist` is generated.
- Migrating a JS module to TypeScript is a welcome contribution.
- **Building or changing a screen (or any UI)?** Follow the one mandated front-end pattern — see
  [**Adding a new screen**](#adding-a-new-screen-front-end-architecture) below.

### Syncing shared types

The shared type definitions are authored in `client/src/public/js/types/commonTypesupport.ts` and
need to be copied into `server/src/types/` when changed:

```bash
npm run sync:types
```

Run this after editing the shared types file so the server TypeScript project picks up the changes.

## Adding a new screen (front-end architecture)

Ham.Live's front end follows **one mandated pattern**: a per-view TypeScript entry point that wires
**reactive stores** to **native Web Component widgets**. **The `liveNet` view is the reference
implementation — copy its shape.** The full rules and rationale are in the **"Architectural
direction"** section of [`CLAUDE.md`](CLAUDE.md). The short version: **no front-end framework, no data
fetching inside widgets, TypeScript only.**

Checklist for a new screen, mirroring `client/src/public/js/byView/liveNet/main.ts`:

1. **Server view + route.** Add `server/dist/views/<view>.ejs` and wire its route/controller (the
   controller sets `VIEW` so the standard module tag resolves):
   `<script src="/js/byView/<%= VIEW %>/main.js" type="module"></script>`.
2. **Per-view entry.** Create `client/src/public/js/byView/<view>/main.ts` — the *only* wiring code
   for the screen.
3. **Store(s).** For each data source, add a `ReactiveStore<T>` subclass in
   `client/src/public/js/lib/stores.ts`, bound to an `EndPointClient` (define the typed
   `EndPointResponse` under `client/src/public/js/types/`). The store owns **all** I/O — it
   short-polls and auto-upgrades to SSE when the API response includes an `ssePath`. **Widgets never
   fetch.**
4. **Widget(s).** For each piece of UI, add a `HamLiveElement<TStore>` subclass in
   `client/src/public/js/lib/widgets.ts`: extend `HTMLElement`, register `hl-<tag>` via
   `customElements.define`, and implement `getTemplate()`, `didMyDataSegmentChange()`, `render()`,
   `onConnected()`, `onDisconnected()`. Put the `<hl-...>` tags in your EJS view.
5. **Compose** in `main.ts`: `new EndPointClient(...)` → `new SomeReactiveStore(ep)` →
   `SomeWidget.init(store)` for each widget (wrap each in `initAndLogError` for isolation) →
   `store.init()` to start the data flow. Static widgets (no store) just call `.init()`.
6. **Build & verify:** `npm run build` (or `npm run dev`), load the page, and confirm live updates
   work.

🚫 Do **not** add a front-end framework, jQuery, ad-hoc/inline DOM scripts, or new plain-JavaScript
view code — port to this TypeScript pattern instead.

## Configuration & secrets

- **Never commit secrets.** All credentials and per-instance values come from environment variables
  (see `.env.example`); the committed YAML in `server/dist/*.yaml` holds non-secret structure only.
- `.env` is git-ignored. Don't add secret-bearing files.
- New configuration should be read in `server/dist/lib/configLib.js` and documented in `.env.example`.

## Style

- Formatting is handled by **Prettier** (`.prettierrc.json`). Run your editor's Prettier integration
  or `npx prettier --write` on files you touch.
- Linting config is in `client/.eslintrc.cjs`.

## Submitting changes

1. Branch from `main`.
2. Keep changes focused; match the style of surrounding code.
3. Verify a local run still works (see the test drive steps) before opening a PR.
4. Update relevant docs in `docs/` and `.env.example` if you change behavior or configuration.

## Reporting issues

Open an issue describing what you expected, what happened, and steps to reproduce. For security
issues, please report privately rather than opening a public issue.
