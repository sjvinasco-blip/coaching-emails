# STGC Masterclass Engine

Email automation for **She's That Girl Co.** — Sophia's brand teaching women to earn from making
content for brands (UGC). The funnel: run a **free masterclass** → convert attendees to a **$26
blueprint** → then to a **$99.99/mo creator network**. This repo automates every email around it.

**These are not a normal Node app.** There is no server and no `npm start`. Each file in `flows/` is
a [BubbleLab](https://bubblelab.ai) flow — a TypeScript class that runs in BubbleLab's cloud, woken
by a **webhook** (a form was submitted) or a **cron** (a clock). Edit them here for review, then
apply the same change in BubbleLab. **The repo is a mirror, not a deploy source.**

## How it works

```
              shesthatgirl.co/api/content
              (date / time / zoom link — Sophia edits these herself at /admin)
                        │ read live on every send
                        ▼
signs up ──webhook──▶ ① CONFIRM ──▶ "you're in" + Zoom link
                        │
                  ⑤ RE-ENGAGE ──▶ warm leads, "come to the masterclass"
                        │
                    ② REMIND ──▶ day before  +  1 hour before
                        │
                  [ MASTERCLASS ]
                        │
                 ⑥ ATTENDANCE ──▶ marks Attended / No-show
                        │
                   ③ NURTURE ──▶ day 0/2/3/5/7 → $26 → $99.99/mo

brand emails ──webhook──▶ ④ BRAND INBOUND ──▶ auto-reply + notify Sophia
```

**All state lives in one Google Sheet**, `STGC Masterclass Engine`
(`1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0`), with 5 tabs: `Masterclasses`, `Signups`,
`EmailLog`, `Leads`, `BrandLeads`. **The column schemas are the `HEADERS` object at the top of
`flows/setup-and-migrate.ts` — read that first, it is the data model.** No database, by design.

Two ideas hold it together:

- **A masterclass is identified by its local date** (`2026-07-16`). Each date is its own cohort, so
  someone can attend in July and again in August. Signups dedupe on `masterclass_id + normalized email`.
- **`EmailLog` is a ledger.** Before sending, a flow asks "have I already sent *this* email to *this*
  person for *this* masterclass?" via a deterministic `email_key` of
  `${masterclass_id}:${normalized_email}:${sequence_id}`. That is why a 15-minute cron can run 96
  times a day without spamming anyone. **A `:failed` or `:expired` suffix never matches "already
  sent"**, so failures retry and misses stay visible.

**Everything fails closed.** No date, no link, a broken API, an unusable time? It sends nothing and
reports why. Silence beats a wrong email.

## The flows

Deployed in BubbleLab **org 5034** (`sjvinasco@gmail.com`), reading the sheet via Varnica's Google
credential. **Nothing is active** — every flow is `isActive: false`, `cronActive: false`.

| File | ID | Trigger | What it does |
|------|----|---------|--------------|
| `flow-1-signup-confirmation.ts` | 13255 | webhook | Signup → dedupe → save → confirmation with the live Zoom link |
| `flow-2-reminders.ts` | 13254 | cron `*/15 * * * *` | Day-before + 1-hour-before reminders |
| `flow-3-nurture.ts` | 13256 | cron `0 15 * * *` | Day 0/2/3/5/7 sequence toward the offers. Day 0 is attendance-gated |
| `flow-4-brand-inbound.ts` | 13257 | webhook | Brand inquiry → `BrandLeads` + auto-reply + notify Sophia |
| `flow-5-reengagement.ts` | 13258 | cron `0 16 * * 2` | Invites warm `Leads`, excluding current registrants |
| `flow-6-attendance.ts` | 13259 | webhook | Accepts a **pasted** attendee list, marks Attended / No-show. `DRY_RUN` previews |
| `flow-6b-zoom-attendance.ts` | 13277 | webhook | Pulls the attendee list **straight from Zoom** (S2S OAuth), then the same reconcile. `DRY_RUN` previews |

Supporting files, **not deployed to org 5034**: `setup-and-migrate.ts` (one-time sheet creation +
legacy migration; still the schema source of truth), `email-test.ts` (single-template harness),
`outreach-enrich-draft.ts` (separate B2B outbound tool).

**Webhook URLs** — set these in the `stgc-learn` repo, then redeploy the site:

```
WEBHOOK_URL       https://api.nodex.bubblelab.ai/webhook/user_3FxhYVXJBYjQpcQr4aDE2uRHrrY/e7rP72XYSf5g
BRAND_WEBHOOK_URL https://api.nodex.bubblelab.ai/webhook/user_3FxhYVXJBYjQpcQr4aDE2uRHrrY/scjNgUKVVTr1
```

## Rules — do not break these

- **`TEST_MODE = true`** in every email flow (and `DRY_RUN = true` in Flow 6) routes all mail to
  **itismevarnica@gmail.com** only. **Never flip it except at approved go-live.** The real recipient
  stays visible as `intendedTo` in the output.
- **No em dashes in customer-facing copy** (brand voice). `stripDashes` enforces it in code where AI
  writes the text; keep it.
- **Never hardcode a masterclass date, time, link, or title** — read them from `/api/content`.
- **Sender** stays `welcome@hello.bubblelab.ai` with `reply_to: hello@shesthatgirl.co` until the
  `shesthatgirl.co` domain is verified in Resend. Then flip to `Sophia <hello@shesthatgirl.co>`.
- **The `BRAND` object** (terracotta rose on cream, Cormorant Garamond + Jost, "S" monogram) is
  duplicated in every email flow. Keep them in sync.

## Changing email copy

Each flow keeps its wording in a labelled **`EMAIL_COPY`** block at the top, separate from the HTML.
Change the words inside the quotes; that is all. Keep every `{curlyToken}` exactly as written — they
auto-fill per person. Note `{time}` already includes the correct timezone (e.g. "9:00 PM CDT"), so
never write the zone yourself. Don't touch the `build*Html()` functions — they are only styling.

The approved copy for every email lives in [`docs/email-pipelines.md`](docs/email-pipelines.md).

## Zoom attendance (Flow 6b)

Attendance is pulled from Zoom's Report API via a **Server-to-Server OAuth** app on the
`svinasco@shesthatgirl.co` Zoom account (Pro plan). It reuses Flow 6's reconcile-and-write step, so
the paste path (Flow 6) stays as a fallback that needs no Zoom setup.

- **Credential:** the app's `client_id:client_secret`, **base64-encoded**, stored as a
  `CUSTOM_AUTH_KEY` (id 2862). The `account_id` (`LqhPROKCT8WQEZ_ALBfrWA`) is not secret and lives in
  the flow constant. Scope required: `report:read:list_meeting_participants:admin`.
- **Why base64 pre-encoded:** BubbleLab's `HttpBubble` `authType: 'basic'` emits `Basic <stored
  value>` **without** base64-encoding it (confirmed via request echo). Storing the already-encoded
  value is the workaround; `authType: 'basic'` then produces a valid header.
- **The masterclass is a recurring meeting** (id `91498122584`, type 3), so attendance is
  per-occurrence: the flow lists ended instances, matches the one on the cohort's local date, and
  pulls that occurrence's participants. Pass `occurrenceUuid` to override the date match.
- **Verified live:** token exchange, meeting resolution, and a real participant fetch
  (`attendeesFetched > 0`) all work. Guests who join without signing in have no email in Zoom's
  report and are counted as `attendeesWithoutEmail` (unmatchable).
- **How to run it:** after a masterclass, POST `{ "masterclassId": "YYYY-MM-DD" }` to the flow's
  webhook with `dryRun` on to preview, then `dryRun: false` to write. Zoom's report can lag a few
  minutes after a session ends.
- **Future option:** the S2S app's Secret Token is for a `meeting.ended` Zoom webhook, which would
  let this run automatically per session instead of manually. Not built yet.

## BubbleLab gotchas the validator (and runtime) enforce

Not documented in `read-flow-rules`; each one bites:

- A **method call inside a ternary** cannot be instrumented. Use `if`/`else`.
- A `schedule/cron` `handle()` **must** take a `payload: CronEvent`, even if unused.
- The cron must be a **`readonly cronSchedule = '...'` class property**.
- `HttpBubble` `authType: 'basic'` does **not** base64-encode — store the pre-encoded value.
- Also: private methods cannot call other private methods (loops live in `handle()`), no `throw` or
  `try/catch` in `handle()`, no `any`, and every bubble needs its own uniquely-named `const`.

## Before anything goes live

**See [`docs/validation-checklist.md`](docs/validation-checklist.md)** — it is the single source for
what is verified, what is not, and what is blocked. The headlines:

- ⛔ **The BubbleLab plan is `free_user` = 2 active workflows.** This funnel is six. Nothing runs
  until that changes.
- ⛔ **Test rows must be purged from the sheet before any cron is activated**, or fixture cohorts
  will keep coming due and email nonexistent addresses.
- ⛔ **The site still posts to the old flows**, which send registrants nothing. Repoint the webhooks
  above, redeploy, and deactivate old flows 9294 + 9485.
- ⚠️ **What does `/admin` mean by the time it stores?** `02:00Z` labelled `CST` renders as 9:00 PM
  **CDT**. If the admin panel applies a fixed −6 offset, Sophia's intent may be an hour earlier and
  every reminder is off. Undecidable from the data — someone must look.

**Who's who:** Varnica (`vchabria`) built the original flows; Sophia (`sjvinasco-blip`) owns this
repo and the brand; Hardik (`znatri`) is extending it.
