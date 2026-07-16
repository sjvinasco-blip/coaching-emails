# STGC Masterclass Engine

Automation backend for **She's That Girl Co.** — masterclass signup funnel + brand
outreach, built on [BubbleLab](https://bubblelab.ai) flows. This repo is the source
of truth for the flow code so it can be reviewed, versioned, and extended outside the
BubbleLab editor.

> The flows themselves run in the **BubbleLab cloud** (account `bubblelab-svinasco`,
> svinasco@shesthatgirl.co, org 5033). This repo mirrors their source; edits here must
> be pushed back into BubbleLab to go live — the repo is not auto-synced.

---

## What's in here

| File | BubbleLab flow ID | Status | What it does |
|------|-------------------|--------|--------------|
| `flows/setup-and-migrate.ts` | **12916** | ✅ built + run once | Creates the `STGC Masterclass Engine` Google Sheet (5 tabs) and migrates the 122 legacy signups into it. One-time. Sends no email. |
| `flows/email-test.ts` | **12917** | ✅ built + tested | Safety harness: sends ONE branded sample confirmation to a single hardwired inbox. Used to validate the template. |
| `flows/flow-1-signup-confirmation.ts` | **12919** | ✅ built + tested | **Flow 1 of 6.** Webhook signup intake → reads the live masterclass from `shesthatgirl.co/api/content` → dedupes → writes to the sheet → sends the branded confirmation email instantly. |
| `flows/outreach-enrich-draft.ts` | **12926** | ✅ built | Brand/B2B outreach: enriches a pasted company list via Crustdata, drafts a personalized call-booking email per contact (no em dashes), writes drafts to a sheet, optionally sends. |

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

## Known caveats / open items

- ⚠️ **Midnight-UTC time bug.** `/api/content` currently returns the masterclass date at
  midnight UTC with no real time set, so confirmations render "12:00 AM". Sophia must set a
  real time at `shesthatgirl.co/admin` before Flow 2 (reminders) timing is correct.
- ⚠️ **Zoom attendance.** The current masterclass link is LSU institutional Zoom
  (`lsu.zoom.us`) — no API attendance available from an org-owned account. Flow 6 needs Sophia
  hosting on her own Zoom Pro+, or a recap-open / manual fallback.
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
