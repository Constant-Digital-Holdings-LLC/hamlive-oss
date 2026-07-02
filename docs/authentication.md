# Authentication Architecture

This document describes Ham.Live's authentication system, including strategy configuration, session management, and authorization patterns.

## Overview

Ham.Live uses **magic-link email sign-in as the primary and always-present authentication method**. Google OAuth2 is an optional second method that is only activated when its credentials are configured. There is no local/password authentication.

The implementation uses Passport.js and lives in `server/dist/routes/authRoutes.js`; session middleware is configured in `server/dist/server.js`.

## Authentication Stack

| Package                   | Role                                |
| ------------------------- | ----------------------------------- |
| `passport`                | Core authentication framework       |
| `passport-magic-login`    | Magic-link (JWT) email strategy     |
| `passport-google-oauth20` | Google OAuth2 strategy (optional)   |
| `cookie-session`          | Stateless encrypted session cookie  |
| `gravatar`                | Default avatar URL for new accounts |

There is no `passport-local`, no `bcrypt`, no `express-session`, and no `connect-mongo`.

## Magic-Link Authentication (primary)

Magic-link sign-in is always registered. It is powered by `passport-magic-login` and uses a JWT signed with the `MAGIC_LINK_SECRET` environment variable.

### Flow

```
1. User submits email address
   ↓
2. POST /auth/magiclogin
   ↓
3. Server generates a signed JWT and calls sendMagicLink()
   ↓
4. If ZeptoMail or SendGrid is configured: email is sent through the selected provider
   If not (local dev): link is printed to the server console
                       AND returned in the JSON response as devMagicLink
   ↓
5. User opens the link
   ↓
6. GET /auth/magiclogin/callback — Passport validates the JWT
   ↓
7. If user exists: update lastLogin / lastAuthVia / photo
   If user is new: create UserProfile (newAccount:true, flexOptions:{option:{}})
   ↓
8. Check currentUser.locked — deny (done(null, false)) if true
   ↓
9. Redirect to /views/dashboard (if callSign set) or /views/myaccount (new user)
```

### Local development fallback

When no email provider is configured, the sign-in link is:

- Printed to the server console at `info` level with a visible banner.
- Returned to the browser in the `devMagicLink` field of the `/auth/magiclogin` JSON response.

This allows full end-to-end testing with no email configuration required.

### Configuration

| Config key (via `conf`)  | Env var             | Required                             |
| ------------------------ | ------------------- | ------------------------------------ |
| `conf.magic_link_secret` | `MAGIC_LINK_SECRET` | Yes                                  |
| `conf.zeptomail_api_key` | `ZEPTOMAIL_API_KEY` | No (requires `EMAIL_FROM`)           |
| `conf.email_from`        | `EMAIL_FROM`        | No (required for provider delivery)  |
| `conf.sendgrid_api_key`  | `SENDGRID_API_KEY`  | No (see fallback above)              |
| `conf.base_url`          | `BASE_URL`          | Yes (used to build the callback URL) |

ZeptoMail is preferred when both `ZEPTOMAIL_API_KEY` and `EMAIL_FROM` are set. If both ZeptoMail and
SendGrid are configured, ZeptoMail is selected.

The magic-link JWT TTL is 30 days (set in `jwtOptions.expiresIn`).

## Google OAuth2 (optional)

Google OAuth2 is registered only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set:

```javascript
const googleAuthEnabled = Boolean(conf.google_client_id && conf.google_client_secret);
if (googleAuthEnabled) {
    // register GoogleStrategy and routes
}
```

If the credentials are absent, the `/auth/google` and `/auth/google/redirect` routes still exist but redirect to `/views/login` rather than 404-ing.

### Strategy configuration

```javascript
new GoogleStrategy(
    {
        clientID: conf.google_client_id,
        clientSecret: conf.google_client_secret,
        callbackURL: `${conf.base_url}/auth/google/redirect`
    },
    callback
);
```

`conf.google_client_id` and `conf.google_client_secret` come from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — there are no `_DEV` / `_PROD` suffixes.

### Google auth flow

The Google callback mirrors the magic-link verify logic:

- Existing user: update `lastLogin`, `lastAuthVia`, `photo`; check `locked`.
- New user: create `UserProfile` with `newAccount:true` and `flexOptions:{option:{}}`.
- Redirect to `/views/dashboard` or `/views/myaccount` accordingly.

### Routes

| Method | Path                    | Description                                |
| ------ | ----------------------- | ------------------------------------------ |
| `GET`  | `/auth/google`          | Begin OAuth2 flow (scope: profile + email) |
| `GET`  | `/auth/google/redirect` | OAuth2 callback from Google                |

Note: the callback path is `/auth/google/redirect`, not `/auth/google/callback`.

## Routes summary

| Method | Path                        | Description                         |
| ------ | --------------------------- | ----------------------------------- |
| `POST` | `/auth/magiclogin`          | Send magic-link email               |
| `GET`  | `/auth/magiclogin/callback` | Validate JWT, establish session     |
| `GET`  | `/auth/google`              | Begin Google OAuth2 (optional)      |
| `GET`  | `/auth/google/redirect`     | Google OAuth2 callback (optional)   |
| `GET`  | `/auth/logout`              | Log out (async, Passport 0.6 style) |

There is no `POST /auth/logout`.

## Session Management

Sessions use `cookie-session` — a stateless, signed cookie with no server-side store.

```javascript
app.use(
    cookieSession({
        maxAge: 3.5 * 24 * 60 * 60 * 1000, // 3.5 days
        keys: [conf.cookie_session_key]
    })
);
```

Key details:

- Single signing key: `conf.cookie_session_key` (env `COOKIE_SESSION_KEY`). There is no key rotation or secondary key.
- Session lifetime: **3.5 days** (not 7).
- The cookie is renewed on activity: `cookieSessionKeepAlive()` middleware refreshes it every 10 minutes of activity.
- `cookieSessionStubs` provides `regenerate()` and `save()` shims so Passport works with `cookie-session`.

### Logout

Logout uses Passport 0.6's async `req.logout(callback)` signature:

```javascript
router.get('/logout', function (req, res, next) {
    req.logout(function (err) {
        if (err) return next(err);
        res.redirect('/views/dashboard');
    });
});
```

## New-User Creation

Both strategies create new users with the same minimal shape:

```javascript
{
    email:        payload.destination,  // or profile.emails[0].value
    displayName:  '',                   // or profile.displayName for Google
    photo:        gravatar.url(...),    // or profile.photos[0].value for Google
    lastAuthVia:  'email',              // or 'google'
    newAccount:   true,
    flexOptions:  { option: {} }
}
```

There is no `level`, `callSign`, or `okToAdvertise` set at creation time. The `validateBeforeSave: false` flag is used on magic-link user creation.

## Authorization System

### Permission levels

Ham.Live uses a numeric level stored on `UserProfile`:

| Level | Role                        |
| ----- | --------------------------- |
| 0     | System administrator        |
| 1     | Advanced user / net control |
| 2+    | Regular user                |

### Authorization middleware

Route files guard endpoints with `authCheck(...)` from `serverUtils.js`, composing the bit-flag constants `REQ_LOGIN`, `REQ_CALLSIGN`, `REQ_NETOWNER`, and `REQ_SUPERUSER`. The middleware verifies the authenticated `req.user` against the requested flags and redirects (or rejects) when they aren't met. Route handlers read the user's permission level directly from `req.user`; there is no separate `audience` middleware.

### Route protection example

```javascript
// Unauthenticated
app.get('/api/util/server-info', serverInfoHandler);

// Requires login
app.get('/api/data/userprofiles', authCheck(REQ_LOGIN), getUserProfileHandler);

// Requires net ownership or admin
app.post('/api/admin/interactions', authCheck(REQ_LOGIN | REQ_NETOWNER), interactionHandler);
```

## Security notes

- The magic-link JWT is signed with `MAGIC_LINK_SECRET` (required). Use a strong random value (32+ bytes).
- The session cookie is signed with `COOKIE_SESSION_KEY` (required). Use a strong random value (32+ bytes).
- `currentUser.locked` is checked in both strategy verify callbacks; locked accounts are denied without explanation.
- There is no CSRF middleware (`csurf`), no rate limiting (`express-rate-limit`), and no `helmet` in the current codebase. Operators deploying to production should evaluate adding these at the reverse proxy or application layer.

## See also

- [Server Architecture](server-architecture.md) — Express application setup
- [Middleware](middleware.md) — Authentication middleware implementation
- [Security](security.md) — Security policies and considerations
- [Runtime Configuration](runtime-config.md) — Configuration options

(End of authentication architecture documentation.)
