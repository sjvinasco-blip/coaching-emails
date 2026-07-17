# STGC Masterclass Engine

Automation backend for **She's That Girl Co.** — masterclass signup funnel + brand
outreach, built on [BubbleLab](https://bubblelab.ai) flows. This repo is the source
of truth for the flow code so it can be reviewed, versioned, and extended outside the
BubbleLab editor.

> The flows themselves run in the **BubbleLab cloud** (account `bubblelab-svinasco`,
> svinasco@shesthatgirl.co, org 5033). This repo mirrors their source; edits here must
> be pushed back into BubbleLab to go live — the repo is not auto-synced.

---

## For Hardik — start here

**What this is:** the email/automation backend for She's That Girl Co. (STGC), Sophia's
coaching brand. It is a set of [BubbleLab](https://bubblelab.ai) flows — TypeScript files
that extend `BubbleFlow` and orchestrate "bubbles" (Google Sheets, Resend email, HTTP,
AI agents). They are **not** a normal Node app: there is no local server, no `npm start`.
Each flow runs in the BubbleLab cloud and is triggered by a webhook or a cron.

**How the pieces fit:**
- **Data lives in one Google Sheet** — `STGC Masterclass Engine`
  (id `1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0`), 5 tabs. Column schemas are the
  `HEADERS` object at the top of `flows/setup-and-migrate.ts`. Read that first — it's the
  data model for the whole system.
- **Signups** come in from the website (`shesthatgirl.co`) as a webhook → Flow 1 handles
  intake + confirmation email.
- **The current masterclass** (date/time/zoom link) is not hardcoded; Flow 1 fetches it
  live from `https://shesthatgirl.co/api/content` so Sophia can change it from her site
  admin without touching code.
- **Email** goes out through Resend. Until the `shesthatgirl.co` domain is verified, mail
  sends from a BubbleLab system address with Sophia's name; replies route to
  `hello@shesthatgirl.co`.

**What's actually built:** the 4 files in `flows/` (see table below). Of the planned
6-flow funnel, **only Flow 1 is built** — flows 2–6 are the open work. The
outreach flow is a separate B2B/brand tool.

**To change a flow (the critical workflow):**
1. Edit the `.ts` file here and open a PR so it's reviewed + versioned.
2. **Re-apply the same change to the live flow in the `bubblelab-svinasco` BubbleLab
   account** (by flow ID — see the table). Editing this repo alone does **nothing** to
   what runs in production; the repo is a mirror, not a deploy source. To get access to
   the BubbleLab account, ask Varnica/Sophia.
3. Run the flow in BubbleLab to validate before relying on it.

**Golden rules — do not break these** (details in *Conventions* below):
- `TEST_MODE = true` on every email flow means mail only goes to test inboxes. **Never**
  flip it to `false` except at real go-live. If you're testing, keep it `true`.
- No em dashes in any customer-facing copy (brand voice). The outreach flow enforces this
  in code; keep it.
- Don't hardcode a masterclass date/time — read it from `/api/content`.

**Before you start anything real:** skim the *Known caveats* and *Go-live checklist* at
the bottom — several things (Resend domain, real masterclass time, Zoom, Beacons list)
are blocked on external setup that only Sophia can do.

**Who's who:** Varnica (`vchabria`) built the flows; Sophia (`sjvinasco-blip`) owns this
repo and the brand; Hardik (`znatri`) is extending it.

---

## What's in here

| File | BubbleLab flow ID | Status | What it does |
|------|-------------------|--------|--------------|
| `flows/setup-and-migrate.ts` | **12916** | ✅ built + run once | Creates the `STGC Masterclass Engine` Google Sheet (5 tabs) and migrates the 122 legacy signups into it. One-time. Sends no email. |
| `flows/email-test.ts` | **12917** | ✅ built + tested | Safety harness: sends ONE branded sample confirmation to a single hardwired inbox. Used to validate the template. |
| `flows/flow-1-signup-confirmation.ts` | **12919** | ✅ built + tested | **Flow 1 of 6.** Webhook signup intake → reads the live masterclass from `shesthatgirl.co/api/content` → dedupes → writes to the sheet → sends the branded confirmation email instantly. |
| `flows/outreach-enrich-draft.ts` | **12926** | ✅ built | Brand/B2B outreach: enriches a pasted company list via Crustdata, drafts a personalized call-booking email per contact (no em dashes), writes drafts to a sheet, optionally sends. |
### The 6-flow funnel — deployed to Sophia's account (org 5034)

> ⚠️ **These live in a DIFFERENT BubbleLab account from the four above.** They were created in
> `sjvinasco@gmail.com` / **org 5034** ("Sophia Juliette I's Workspace"), because that is the only
> account we have an MCP token for. The original flows (12916–12926) are in
> `svinasco@shesthatgirl.co` / **org 5033**, which nobody on the team can currently reach. So Flow 1
> now exists **twice**: as 12919 in org 5033 and as 13255 in org 5034. Decide which account is the
> real home before go-live.

| File | Flow ID (org 5034) | Trigger | Status | What it does |
|------|--------------------|---------|--------|--------------|
| `flows/flow-1-signup-confirmation.ts` | **13255** | webhook | ✅ run + verified | Signup intake → dedupe → save → branded confirmation with the live Zoom link. |
| `flows/flow-2-reminders.ts` | **13254** | cron `*/15 * * * *` | ⚠️ emails verified via temp copy | Day-before + 1-hour-before reminders, windowed so each sends exactly once and a late registrant never gets a stale "tomorrow" email. Fails closed on unusable timing. |
| `flows/flow-3-nurture.ts` | **13256** | cron `0 15 * * *` | ✅ run + verified | Post-masterclass sequence at day 0/2/3/5/7. All five approved emails present; `ACTIVE_SEQUENCE` controls which send. Day 0 gated on attendance. |
| `flows/flow-4-brand-inbound.ts` | **13257** | webhook | ✅ run + verified | Brand inquiry → `BrandLeads` + auto-reply + notify Sophia. Payload matches what the site posts today. |
| `flows/flow-5-reengagement.ts` | **13258** | cron `0 16 * * 2` | ⚠️ email verified via temp copy | Invites warm `Leads` to the live masterclass, excluding anyone already registered. **The Beacons list does not exist yet.** |
| `flows/flow-6-attendance.ts` | **13259** | webhook | ✅ run + verified | Accepts an attendee list (Zoom CSV paste or manual), marks Attended / No-show. `DRY_RUN` previews. |

**Webhook URLs** (for the `stgc-learn` repo, once you repoint it):
- `WEBHOOK_URL` → `https://api.nodex.bubblelab.ai/webhook/user_3FxhYVXJBYjQpcQr4aDE2uRHrrY/e7rP72XYSf5g`
- `BRAND_WEBHOOK_URL` → `https://api.nodex.bubblelab.ai/webhook/user_3FxhYVXJBYjQpcQr4aDE2uRHrrY/scjNgUKVVTr1`

**What "verified" means.** All six compile under BubbleLab's validator (a real typecheck — it caught
three things static review could not), run successfully against the live engine sheet, and **all 11
emails have been rendered and delivered to the test inbox**. Proven by execution: duplicate
suppression, email normalization, `TEST_MODE` routing, the correct `CDT` label, the attendance gate,
the send caps, and fail-closed behaviour on bad timing.

**Flows 2 and 5 are the caveat.** `/api/content` currently advertises a class in the past, so both
correctly refuse to run. Their emails were exercised through temporary copies with only the class
time injected (since deleted; the real flows were never modified). **Re-run both unmodified once a
future masterclass date is set at `/admin`** — that is the last untested seam.

**Nothing is armed.** All six are `isActive: false`, `cronActive: false`. No cron fires, no webhook
is live. Before activating anything, purge the test rows listed in
[`docs/validation-checklist.md`](docs/validation-checklist.md) — the fixture cohorts keep coming due.

**BubbleLab rules the validator enforces that are NOT in `read-flow-rules`** (learned the hard way,
worth knowing before editing):
- A method call inside a **ternary** is rejected: *"cannot be instrumented"*. Use `if`/`else`.
- A `schedule/cron` flow's `handle()` **must** take a `payload: CronEvent` parameter, even unused.
- The cron must be a **`readonly cronSchedule = '...'` class property**, not just configured in the UI.

---

## Architecture — the 6-flow masterclass funnel

Everything hangs off one Google Sheet, **`STGC Masterclass Engine`**
(spreadsheetId `1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0`), with 5 tabs:
`Masterclasses`, `Signups`, `EmailLog`, `Leads`, `BrandLeads`. Column schemas are
defined at the top of `flows/setup-and-migrate.ts` (`HEADERS`).

The plan is six flows. **Only Flow 1 is built so far.**

1. **Signup intake** (webhook) — ✅ *built* (`flow-1-signup-confirmation.ts`). Reads the
   current masterclass live from `/api/content`, dedupes on `masterclass_id + email`,
   stores the signup, sends the Seq-1 confirmation with the live link/time.
2. **Pre-reminders** (cron ~15 min) — ⬜ *not built*. Day-before + 1-hour-before emails,
   gated by signup timing. **Blocked** on a real masterclass time being set at `/admin`
   (see caveat below).
3. **Post-nurture** (daily cron) — ⬜ *not built*. Day 0/1/2/3/5/7 sequence pushing
   attendees to the $29 offer → coaching.
4. **Brand inbound** (webhook) — ⬜ *not built*. Auto-reply with booking + case-studies
   link, notify Sophia, log to `BrandLeads`. (Closest sibling already built =
   `outreach-enrich-draft.ts`, which is the *outbound* side.)
5. **Warm re-engagement** (cron) — ⬜ *not built*. Re-engage the ~113 Beacons subscribers
   (non-registrants). Status column: New → Nurturing → Registered → Attended → No-show → Cold.
6. **Zoom attendance sync** — ⬜ *not built*. Mark Attended / No-show by email; exclude
   attendees from the next masterclass's invites.

---

## Conventions you must keep

- **`TEST_MODE`** — every email-sending flow has a `TEST_MODE` boolean + test recipient
  constant at the top. While `true`, all mail goes ONLY to the test inbox(es), never a
  real registrant. **Go-live = flip `TEST_MODE` to `false`.** Do not remove this pattern.
- **Sender identity** — until the `shesthatgirl.co` domain is verified in Resend, `FROM_ADDRESS`
  must stay on BubbleLab's system domain (`welcome@hello.bubblelab.ai`) with Sophia's name on
  it and `reply_to = hello@shesthatgirl.co`. After verification, flip `FROM_ADDRESS` to
  `Sophia <hello@shesthatgirl.co>`.
- **No em dashes** in any customer-facing copy (brand voice rule). The outreach flow enforces
  this in code (`stripDashes`) *and* in the AI system prompt — keep both.
- **Brand tokens** — the `BRAND` object (terracotta rose on cream, Cormorant Garamond + Jost,
  "S" monogram) is duplicated in each email flow. Keep them in sync.
- **Masterclass identity** — a masterclass's `id` is its local calendar date (`YYYY-MM-DD`).
  Each date is its own cohort; signups dedupe on `masterclass_id + email`.

---

## How the email copy is changed

Every email flow keeps its wording in one labeled **`EMAIL_COPY`** block at the top of the
file, separated from the HTML. Sophia (or anyone) changes what registrants receive by editing
the text inside the quotes — nothing else.

- **Where:** `flows/flow-1-signup-confirmation.ts` → the `EMAIL_COPY` block near the top
  (subject, heading, greeting, intro, CTA label, body `paragraphs`, sign-off, P.S.).
- **Tokens:** keep `{firstName}`, `{title}`, `{date}`, `{time}`, `{link}` exactly as written —
  they auto-fill per registrant. Everything else is free text.
- **Add/remove a paragraph:** add or remove a line in `paragraphs`.
- **Don't touch** `buildConfirmationHtml()` — that's only the branded styling wrapper.
- **To go live:** editing this repo does nothing on its own. Apply the same `EMAIL_COPY`
  change to **BubbleLab flow 12919** (in the `bubblelab-svinasco` account) and re-run it once
  to confirm — the flow validates and sends to the test inbox while `TEST_MODE` is on.

The full approved copy for **all 8 emails** (Seq 1 built; Seq 2–3 + Beacons + brand outreach
not built yet) lives in [`docs/email-pipelines.md`](docs/email-pipelines.md). Build flows 2–6
by lifting the copy from there into the same `EMAIL_COPY` pattern.

> Test recipient is hardwired to **itismevarnica@gmail.com** only while `TEST_MODE = true`.

## Known caveats / open items

- ✅ ~~**Midnight-UTC time bug.**~~ **Resolved (verified 2026-07-16).** `/api/content` now returns a
  real time: `stgc_settings.date = "2026-07-17T02:00:00.000Z"`, which is 9:00 PM CDT. The flows still
  treat midnight-UTC as a code path that must fail closed, but it is no longer the current state.
  ⚠️ A harder question replaced it: the label says `CST` while the instant is CDT, so if `/admin`
  naively applies a fixed −6 offset, Sophia's intended time may be an hour earlier than what renders.
  Someone must check what `/admin` actually stores.
- ⚠️ **Zoom attendance.** ~~LSU institutional Zoom~~ — `/api/content` now returns a plain
  `zoom.us/j/...` link, and Sophia has a brand-owned Zoom login, so this may be unblocked. **But the
  plan tier is unconfirmed**, and Zoom's participant-report API needs a paid plan on the hosting
  account. `flows/flow-6-attendance.ts` therefore accepts attendance via webhook/CSV, which works
  either way; a Zoom pull can later replace its input without touching the matching logic.
- **Website webhooks** (`stgc-learn` repo: `WEBHOOK_URL`, `BRAND_WEBHOOK_URL`) still point at
  the old cloud BubbleLab account and must be repointed to the new `svinasco` webhooks + redeployed.

## Go-live checklist (blocked on external setup)

- [ ] Resend account + verify `shesthatgirl.co` DNS → real sender
- [ ] Set real masterclass **time** at `/admin` (fixes midnight-UTC)
- [ ] Calendly link + API connect (brand flow + conversion tracking)
- [ ] Beacons CSV of the ~113 warm leads → `Leads` tab
- [ ] Zoom hosting decision
- [ ] Repoint website webhooks + redeploy
- [ ] Final product prices/links, testimonial for Seq3, physical mailing address (CAN-SPAM)
- [ ] Flip every `TEST_MODE` to `false`

---

## Working on the flows

These are BubbleLab flow files (`extends BubbleFlow<...>`, `@bubblelab/bubble-core`
bubbles). They are edited/run through the BubbleLab MCP tools or the BubbleLab web editor,
not a local `node` runtime. To change a flow: edit here for review, then apply the same edit
to the corresponding flow ID in the `bubblelab-svinasco` account and re-run to validate.
