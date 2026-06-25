# Email templates

Some Ham.Live emails are sent through **SendGrid dynamic templates** — the HTML lives in your
SendGrid account and the app references it by template ID. This folder holds **reference copies** of
those templates so you can recreate them in your own account.

> These files are *reference only* — the running app does not read them. Import the HTML into
> SendGrid, then point the app at your own template via the matching environment variable.

## Templates

| File | Sent by | Env var | When |
|------|---------|---------|------|
| [`net-close-report.html`](net-close-report.html) | `NetCloseReport` (`server/dist/lib/userNotification.js`) | `SENDGRID_NET_CLOSE_TEMPLATE_ID` | Emailed to the net owner when a net closes — the post-net log |

If the env var is unset, that email is simply **skipped** (with a log line) — the rest of the app
works normally.

## How to use one

1. In SendGrid: **Email API → Dynamic Templates → Create a Dynamic Template**, add a version, and
   paste the contents of the `.html` file here into the Code Editor.
2. Copy the new template's ID (looks like `d-xxxxxxxx…`).
3. Put it in your `.env` under the matching variable above — e.g.
   `SENDGRID_NET_CLOSE_TEMPLATE_ID=d-xxxxxxxx…` — and restart.

## Template data — `net-close-report.html`

The app passes these `dynamic_template_data` fields (Handlebars):

| Variable | Contents |
|----------|----------|
| `subject` | `"{title} - Net Close Report"` |
| `title` | net title |
| `url` | full link to the net |
| `startedAtString` | net start time (UTC string), or empty |
| `formattedAttendees` | array of `{ callSign, role, checkInTime, displayName, location, sigReport, highlight }` |

Two files are also **attached automatically by the code** (no template work needed): a CSV roster
(`…_report.csv`) and a chat-log text file (`…_chat.txt`).
