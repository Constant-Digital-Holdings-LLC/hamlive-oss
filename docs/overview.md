# Overview

Ham.Live is a browser-first web application that helps amateur radio operators discover, join, and run "nets" — coordinated on-air meetups where stations check-in, exchange reports, and follow a moderated agenda.

This document provides a product-oriented overview focusing on what the system does for users. For technical architecture and implementation details, see [Architecture](architecture.md).

## Product Overview

### What Ham.Live provides

- **Net discovery and scheduling** — users can find active nets or browse scheduled nets and follow those they care about
- **Real-time presence & interactions** — when on a net page the site captures presence, renders an ordered station list, and surfaces live interactions such as "hand", "highlight", "check state" and signal reports
- **Net control (NCS features)** — designated net controllers can start/stop nets, assign roles, and perform administrative actions to manage participant flow
- **Chat and media attachments** — real-time chat via GetStream.io with inline image sharing and server‑side token generation to protect API secrets (see [Chat System](chat-system.md))
- **Follow and notifications** — users may follow nets and receive announcements or summaries when nets start or change

### Primary user journeys

- **Join a net:** navigate to a net page, client captures presence and displays the canonical station list. Presence is updated frequently and reconciled with SSE or polling responses so the UI stays current
- **Run a net (NCS):** the net controller starts the net, watches the station queue, assigns roles, and uses admin commands exposed by the server to manage the session
- **Interact:** participants submit interactions (hands, checks, sig reports) that are applied optimistically in the UI and confirmed by server responses (SSE or next poll)

### Key user roles

- **Participant:** joins nets, sends interactions, and views the live station order
- **Net Control / NCS:** authorized to start/stop nets, assign roles, and call administrative endpoints
- **Admin / Operator:** manages NetProfiles, runs recovery or maintenance commands and monitors system health

## Technical Overview

Ham.Live is a Node.js + Express web application with a no-bundler, reactive client framework. It presents and manages **nets** (live radio nets) and station interactions, serving server-rendered EJS views plus JSON APIs, with real-time updates pushed to clients over Server-Sent Events.

**See [HL-main.svg](HL-main.svg) for a visual diagram** of the core runtime flows.

### Key technologies

- **Backend**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: magic-link email (primary) + optional Google OAuth, signed `cookie-session` cookies
- **Real-time**: Server-Sent Events with polling fallback
- **Frontend**: TypeScript ES modules, Custom Elements, and reactive stores (no bundler)

### High-level runtime flow

1. A browser loads an EJS view (e.g. `/views/livenet/:id`). The view injects `serverInfo` attributes and loads a per-view ES module from the compiled client output (`/js/byView/<view>/main.js`).
2. Client code (widgets and libraries) requests data from the JSON API (`/api/data/*`) and subscribes to presence or live updates via SSE (`/api/sse/livenets/:id`) or short polling.
3. The server responds to API calls, issues tokens for GetStream.io chat, and pushes real-time `LiveNetDetails` updates through the SSE manager (`realtimeClients`).
4. Client stores apply updates optimistically and reconcile against the next server response.

> 📖 For full technical detail, see [Architecture](architecture.md).

## Getting Started

### For users and net-control operators

End-user instructions — signing in, joining and following nets, running a net, account settings, and the
net-control commands — live in the in-app **[User Guide](user-guide.md)** (served at `/views/guide`).

### For Developers

- **Setup**: See [Developer Setup](developer-setup.md) for local development
- **Architecture**: Review [Architecture](architecture.md) for system overview
- **API**: Check [API Reference](api-reference.md) for endpoint documentation

## Documentation Index

### Product and User Documentation

1. [Overview](overview.md) — This document (product overview)
2. [User Guide](user-guide.md) — How to join and run nets (end-user how-tos)
3. [Net Admin Commands Reference](net-admin-commands-reference.md) — Net-control command list + cheat sheet
4. [Views](views.md) — User interface and page descriptions

### Technical Architecture

1. [Architecture](architecture.md) — Technical overview and component index
2. [Server Architecture](server-architecture.md) — Express.js application structure
3. [Database Models](database-models.md) — MongoDB schemas and relationships
4. [Runtime Configuration](runtime-config.md) — Configuration system
5. [Authentication](authentication.md) — OAuth and session management
6. [Routing and API](routing-api.md) — API organization and patterns
7. [SSE Architecture](sse-architecture.md) — Real-time communication
8. [Client Framework](client-framework.md) — Browser-side reactive framework

### Implementation Details

1. [Controllers](controllers.md) — Route handlers and business logic
2. [Middleware](middleware.md) — Request processing pipeline
3. [Background Jobs](background-jobs.md) — Scheduled tasks and CLI tools
4. [Shared Net Operations](shared-net-ops.md) — Core domain logic
5. [System Notifications](system-notifications.md) — User notification framework
6. [Chat System](chat-system.md) — GetStream.io chat integration
7. [Security](security.md) — Security policies and implementation

### Reference Materials

1. [API Reference](api-reference.md) — Complete endpoint documentation
2. [Data Model](data-model.md) — Quick reference to database entities
3. [Types](types.md) — TypeScript type system and validation
4. [FlexOptions](flex-opts.md) — Runtime configuration options

### Operations and Deployment

1. [Developer Setup](developer-setup.md) — Local development environment
2. [Runbook](runbook.md) — Operational procedures and monitoring

This documentation system provides comprehensive coverage of Ham.Live's architecture, implementation, and operations. Start with the Architecture document for technical overview, or dive into specific areas based on your needs.

### Data Flow Architecture

**Client → Server:**

- Widgets use `EndPointClient` for user-driven actions
- Stores use `Looper` polling or subscribe to SSE to receive `LiveNetDetails` payloads
- Optimistic updates applied locally, confirmed by server responses

**Server → Client:**

- Express controllers handle `/api/*` routes and return `EndPointResponse` envelopes
- Real-time updates via SSE (`/api/sse/livenets/:id`) or polling fallback
- `realtimeClients` manages SSE connections and pushes live updates

### Development Architecture

**Per-view pattern:**

- Each page loads a small ESM entry script for that view (e.g., `/js/byView/<view>/main.js`)
- Entry scripts initialize stores and widgets specific to that page
- Shared libraries provide common functionality across views

**Widget pattern:**

- Custom elements extending `HamLiveElement<T>` subscribe to reactive stores
- Widgets implement `getTemplate()`, `didMyDataSegmentChange()`, and `render()` methods
- Shadow DOM encapsulation with shared CSS variables for theming

### Domain Logic & Persistence

**Core business logic:**

- Domain logic and state management are centralized in `SharedNetOps` functions with comprehensive validation and permission checking
- All net operations, interactions, and state transitions go through this canonical business layer

For detailed information about system operations and data management, see:

- [Background Jobs](background-jobs.md) — Scheduled tasks, CLI tools, and asynchronous processing
- [Shared Net Operations](shared-net-ops.md) — Core business logic and domain operations

**Data persistence:**

- MongoDB with Mongoose schemas, including FlexOptions for runtime configuration
- Comprehensive indexing for performance and well-defined relationships between collections

**Third-party integrations:**

- GetStream.io (chat with inline image sharing), ZeptoMail or SendGrid (email), and external
  lookups (QRZ.com)
- Wired via server helpers and token/endorsement routes so credentials stay server-side

### Why This Architecture Matters

**For developers:**

- **Small runtime footprint**: The client avoids large frameworks and bundles; pages load per-view ES modules and use native browser primitives where possible
- **Clear separation**: Server-side endorsement routes prevent exposing secrets; controllers and compiled `server/dist` artifacts reveal the authoritative endpoint list and payload shapes
- **Deterministic testability**: The repository includes canonical LiveNet payload examples so tests can stub endpoints deterministically

**For integrators:**

- **Standard envelopes**: All server responses use the canonical `EndPointResponse` JSON envelope
- **Real-time options**: Choose between SSE streams or polling based on client capabilities
- **Clear API contracts**: Comprehensive endpoint documentation with example payloads

## Next Steps

**For new contributors:**

1. [Developer Setup](developer-setup.md) — Environment configuration and build process
2. [Client Framework](client-framework.md) — Client bootstrap, stores and reactive patterns
3. [Views](views.md) — EJS view contracts and per‑view bootstraps

**For system architects:**

1. [Database Schema](database-schema.md) — Complete MongoDB schema documentation
2. [SharedNetOps](shared-net-ops.md) — Domain logic functions and business rules
3. [Runtime Config](runtime-config.md) — Configuration system and feature flags

**For operators:**

1. [Security](security.md) — Authentication, authorization, endpoint security, and session management
2. [Runbook](runbook.md) — Operational procedures and troubleshooting

**For detailed examples:**

- [Net Admin Commands](net-admin-commands-reference.md) — Complete NCS command reference

This overview is intentionally pragmatic and tied to the current codebase. See the linked pages for implementation specifics, example envelopes, and developer runbook steps.
