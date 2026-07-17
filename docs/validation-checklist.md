# STGC Engine — validation, fixes, and follow-ups

> **Status as of 2026-07-17.** All six flows are now deployed to **org 5034**
> (`sjvinasco@gmail.com`), compiled by BubbleLab's validator, and wired to a Google Sheets
> credential (id 2859, authorized as `itismevarnica@gmail.com`, confirmed able to read the engine
> sheet). **Nothing is active: every flow is `isActive:false`, `cronActive:false`.**
>
> **Flows 1 and 6 have been executed successfully against the real sheet.** Flows 2–5 compile but
> have never run. See "Verified by execution" below for exactly what is proven and what is not.
>
> ⚠️ **These are NOT the original flows.** The originals (12916–12926) are in org 5033
> (`svinasco@shesthatgirl.co`), which nobody can reach. Flow 1 now exists twice. Decide the real
> home before go-live.
>
> Status key: ⛔ blocker · ⚠️ decision needed from a human · ✅ verified · ⬜ to do

## Verified by execution (2026-07-17, org 5034, against the live engine sheet)

- ✅ **Google Sheets credential reaches the engine sheet.** Flow 6 read the `Signups` tab.
- ✅ **Flow 1 end-to-end**: `/api/content` → cohort `2026-07-16` → sheet write → Resend send
      (`emailId` returned).
- ✅ **Email normalization.** Submitted `"  Flow1-Verify-20260717@Example.com  "`; stored
      `flow1-verify-20260717@example.com`.
- ✅ **`TEST_MODE` routing.** `sentTo: itismevarnica@gmail.com`, `intendedTo` carried the real
      registrant.
- ✅ **Dedupe / no duplicate send.** Re-submitting as `...@EXAMPLE.com` (different casing) returned
      `duplicate` with **no** second email. This is the bug that used to lose a registrant's link
      permanently.
- ✅ **Timezone fix.** The sent email rendered **"9:00 PM CDT"**, not "9:00 PM CST".
- ✅ **Flow 6 dry run.** Previewed 1 row, wrote nothing, and reported an unregistered attendee as
      `unmatched` rather than inventing a signup.

- ✅ **Flow 4 end-to-end**: normalized the email, wrote `BrandLeads`, notified Sophia
      (`notifySent:true`), and correctly **skipped** the auto-reply because `BOOKING_LINK` is unset.
      A second submit with different casing returned `duplicate` and did not notify twice.
- ✅ **Flow 3 send path + idempotency**: with a seeded past cohort, run 1 sent `seq3_day3`
      (day-offset computed correctly from the cohort date); run 2 returned `already_sent:1` and sent
      nothing. Its `seq3_day0:missing_offer_url` guard also held.
- ✅ **Fail-closed proven live**: Flows 2 and 5 both returned `blocked / masterclass_passed` rather
      than emailing anyone about a class that had already started.

### ✅ Every email in the system has been rendered and sent to the test inbox

All 11 went to `itismevarnica@gmail.com` on 2026-07-17. **Review them for copy and design:**

| Email | Flow | Notes |
|---|---|---|
| Confirmation (`seq1`) | 1 | renders "9:00 PM CDT" |
| Day-before (`seq2a`) | 2 | |
| One-hour-before (`seq2b`) | 2 | sent to 3 registrants |
| Nurture day 0 | 3 | attendance-gated |
| Nurture day 2 / 3 / 5 / 7 | 3 | |
| Re-engagement invite | 5 | lead advanced New → Nurturing |
| Brand auto-reply | 4 | rendered with a placeholder booking link |
| Brand notify (to Sophia) | 4 | |

**How Flows 2 and 5 were exercised:** `/api/content` advertises a class in the past, so both
correctly refuse to run. To reach their send paths, a **temporary copy** of each flow was created
with only the class time injected — window maths, EmailLog keys, and the send path all unchanged —
then deleted. The real flows (13254, 13258) were never modified; verified afterwards.

**What that proved, beyond the emails rendering:**
- `seq2a` correctly **expired/tombstoned** rather than sending, for a class 45 min away — the
  "never send a stale *Tomorrow is your day*" rule, on real data.
- `deferred: 1` — the `TEST_MODE_MAX_SENDS = 3` cap held.
- `not_attended_or_unknown: 2` — the day-0 attendance gate skipped non-attendees.
- Re-runs returned `already_sent` and sent nothing.

⚠️ **Still not proven in the real flows:** the day-before / one-hour-before windows firing off the
*genuine* `/api/content` clock. Re-run Flows 2 and 5 unmodified once a future masterclass date is
set at `/admin` — that is the last untested seam.

### ✅ Zoom attendance integration (Flow 6b) — verified live 2026-07-17

Server-to-Server OAuth against the `svinasco@shesthatgirl.co` Zoom account (Pro). Proven:
- Token exchange works **inside BubbleLab** (after the `HttpBubble` base64 workaround — see README).
- The masterclass meeting (`91498122584`, "Creator Masterclass") is on this account.
- A real participant report was fetched (`attendeesFetched: 1`) and reconciled under `dryRun`.

Not yet possible to prove: an attendee **whose email matches a signup** flipping to `Attended` —
the masterclass has not been hosted on this meeting yet (0 ended occurrences). It is the same set
membership Flow 6 uses. Re-run Flow 6b after the first real session.

- [ ] ⚠️ **Rotate the Zoom Client Secret.** It passed through chat. Regenerate it in the Zoom
      Marketplace, then update credential 2862 (store base64 of `client_id:new_secret`).
- [ ] **Delete unused credential 2861** (raw `client_id:client_secret`, superseded by the base64
      cred 2862). No MCP delete tool exists — remove it in the BubbleLab UI.
- [ ] Decide whether attendance runs **manually** per class (POST `{masterclassId}` to Flow 6b) or
      **automatically** via a Zoom `meeting.ended` webhook (the S2S app's Secret Token is for this;
      not built).

### ⛔ Test rows to purge before go-live

Fake addresses, inert while flows are inactive, but they **suppress re-sends to those keys** and
would **bounce** once `TEST_MODE=false` (bounces damage sender reputation).

- [ ] `Masterclasses`: every row titled **"TEST FIXTURE - delete me"** (`2026-07-09`, `2026-07-11`,
      `2026-07-13`, `2026-07-14`)
- [ ] `Signups`: `flow1-verify-`, `nurture-verify-`, `nurture-d0/d2/d5/d7-`, `reminder-verify-`
      (all `*-20260717@example.com`), plus pre-existing `refactor-check-20260716@example.com`
- [ ] `Leads`: `lead-verify-20260717@example.com` (status will read `Nurturing`)
- [ ] `BrandLeads`: `brand-verify-20260717@example.com`, `autoreply-verify-20260717@example.com`
- [ ] `EmailLog`: every row whose `email_key` contains one of the addresses above
- [ ] ⚠️ **Do this before activating any cron.** The fixture cohorts keep coming due (day 5, day 7)
      and will email nonexistent addresses.

**BubbleLab validator rules NOT in `read-flow-rules`** (found by deploying):
- A method call inside a **ternary** is rejected: *"cannot be instrumented"*. Use `if`/`else`.
- `schedule/cron` `handle()` **must** take a `payload: CronEvent`, even if unused.
- The cron must be a **`readonly cronSchedule = '...'` class property**.

---

## 0. Blockers — nothing downstream is real until these clear

- [ ] ⛔ **Get BubbleLab access to org 5033** (`bubblelab-svinasco`). Without it, no flow can be
      applied, validated, or run. This gates every other box on this page.
- [ ] ⛔ **The website still points at the OLD flows.** Both are live in org 2703 and taking real
      traffic right now:
      - `9294` "sophia masterclass" — 129 runs, **last real signup 2026-07-14**. Writes to the
        **old** sheet (`1wdoyswt8...`) and emails an *admin notification*. **The registrant gets
        nothing.**
      - `9485` "Brand Inquiry Automation" — 10 runs. Writes to a **third** sheet
        (`17r-3C7SSI...`), no auto-reply, no TEST_MODE.

      Until `WEBHOOK_URL` / `BRAND_WEBHOOK_URL` in the `stgc-learn` repo are repointed and the site
      is redeployed, **nothing in this repo runs in production.**
- [ ] ⛔ **Reconcile the old sheet against the new `Signups` tab.** The migration copied 122 rows,
      but flow 9294 has kept writing to the old sheet ever since. Those newer signups are **not** in
      the engine sheet. Decide whether to re-migrate the delta or accept the gap — the two are
      diverging a little more with every signup.
- [ ] ⛔ **How do registrants get their Zoom link today?** Flow 9294 sends only an admin
      notification. Either the site shows the link on-page, or Sophia sends it by hand, or people
      are not getting it. Confirm which before go-live planning.

---

## 1. Per-flow validation

Same three steps for every flow, in BubbleLab, once access exists:
**(a)** paste the file into its flow → BubbleLab's validator compiles it (this is the only real
typecheck available); **(b)** run with test data; **(c)** verify the sheet rows, the email routing,
and the execution log.

### Flow 1 — signup confirmation (`flow-1-signup-confirmation.ts`, id **12919**)

Fixed this round, all unverified:

- [ ] Validate: a **duplicate webhook** returns `duplicate` and sends nothing.
- [ ] Validate: **a failed send is retryable.** Was the worst bug — the signup row was written
      before the send, so a Resend failure left someone marked `Registered` who never got a link,
      and a retry hit the dedupe check and returned before reaching the send. Now `EmailLog`
      decides, not the signup row.
- [ ] Validate: `EmailLog.email_key` now reads `2026-07-16:someone@x.com:seq1`, not the old literal
      `confirmation`. **Everything else depends on this** — Flows 2/3/5 all key off it.
- [ ] Validate: an `/api/content` outage returns `error` and sends **no** email (was: "TBA" + dead
      link).
- [ ] Validate: the email renders **"9:00 PM CDT"**, not "9:00 PM CST", for a summer class.
- [ ] Validate: `" Sophia@Gmail.com "` and `sophia@gmail.com` are treated as one person.
- [ ] ⚠️ **`TEST_MODE` makes EmailLog lie.** It records a `seq1` success against the *real*
      registrant for an email that only went to the test inbox. Harmless while testing, but it means
      **the first real run will skip anyone "confirmed" during testing.** Clear test rows out of
      EmailLog before go-live.
- [ ] ⚠️ Approved copy has a line the built email omits: *"I built this masterclass for the woman
      who knows she's meant for more…"*. Add it back or accept the cut (`docs/email-pipelines.md:54`).
- [ ] ⚠️ No **Add to Calendar** link. The `calendar_link` column exists and is written empty;
      `email-test.ts` has a button labelled "Add to Calendar" that actually points at the Zoom link.
      Somebody has to decide who generates that URL.

### Flow 2 — pre-masterclass reminders (`flow-2-reminders.ts`, **new, no flow id yet**)

- [ ] Create the flow in BubbleLab, set cron `*/15 * * * *` (**UTC**), record the id in the README.
- [ ] **Ship it with the send loop disabled first.** This flow's failure mode is emailing real people
      at wrong times. Run a full cycle, read the `census` in the output against real signups, and only
      then switch sends on.
- [ ] Validate: two ticks in a row send **once**, not twice (this is the whole ballgame for a
      96-times-a-day cron).
- [ ] Validate: a **late registrant** (signs up 3h before the class) gets the 1-hour reminder and
      **never** the "Tomorrow is your day" email.
- [ ] Validate: a blocked run (bad `/api/content`) constructs **no** send bubble at all.
- [ ] Validate the **kill switch**: setting `Masterclasses.status` to `cancelled` stops all sends.
- [ ] ⚠️ **Is `not_yet_due` logging acceptable?** The brief says "log every skip decision". Done
      literally that is ~23,000 rows/day, which destroys the tab and slows the ledger read that
      idempotency depends on. As built: terminal decisions (`:expired`, `:failed`) go to EmailLog;
      the full per-tick census goes in the execution output. **Confirm this reading.**
- [ ] ⚠️ **`ALLOW_MIDNIGHT_UTC_START = false`.** A start of exactly `00:00:00.000Z` is blocked,
      because it is indistinguishable from the old "no time set" bug — but it is *also* **7:00 PM
      CDT**, a perfectly plausible class time. If Sophia ever schedules 7 PM Central, reminders go
      silent until someone flips this. (A *date-only* string is blocked unconditionally and that
      one has no false positives.)
- [ ] ⚠️ **Copy deviation:** the approved copy hardcodes `[Time] CST`. Kept as `{time}` (which now
      carries the correct abbreviation), because "9:00 PM CDT CST" would otherwise print. Needs
      sign-off.
- [ ] ⚠️ `HOUR_BEFORE_GRACE_MS = 30min` → the "We start in 60 minutes" email can arrive with 30
      minutes left. Wider = survives more missed cron ticks; narrower = the subject line stays truer.
      This is a copy-accuracy call, not an engineering one.

### Flow 3 — post-masterclass nurture (`flow-3-nurture.ts`, **new, no flow id yet**)

- [ ] Create in BubbleLab, cron `0 15 * * *` (**UTC** = 10am CDT), record the id.
- [ ] ⚠️ **Which emails actually send?** Sophia said "reduce to 1-3 emails"; the doc holds all five.
      All five copy blocks are kept in the file and `ACTIVE_SEQUENCE` decides which go out. The
      current default is **my guess, not her decision**: `seq3_day0` (thank-you + Blueprint),
      `seq3_day3` (Creator Network), `seq3_day5` (objections — the one she singled out with *"if I
      have to choose between this one and the next one, I choose this one"*). **She needs to confirm.**
      Changing it is a one-line edit.
- [ ] ⛔ **`BLUEPRINT_URL` is empty**, so the Day 0 email **cannot send** (it is reported in
      `blockedSteps` instead of shipping a dead button). Needs the real product link.
- [ ] ⚠️ **The price is contradictory in three places.** `docs/email-pipelines.md` says **$26**,
      notes Notion says **$26.99**, and the project brief says **$29**. The copy currently says $26.
      Resolve before anything sends.
- [ ] ⚠️ **Day 0 depends on Flow 6.** Its copy says *"Not everyone who signs up actually shows up.
      You did."* — a lie if sent to a no-show. So it only sends to people marked attended, which
      means **it sends to nobody until attendance is being recorded.** That is deliberate, and it is
      also why Day 0 cannot fire before the class has happened.
- [ ] ⬜ Add the real student win / testimonial to the Day 3 email (`docs/email-pipelines.md:262`).
- [ ] ⬜ Decide the urgency line in Day 3 (price increase / deadline / bonus) or drop the placeholder.
- [ ] ⬜ Confirm coaching pricing before the Day 7 "reply READY" email is switched on.

### Flow 4 — brand inbound (`flow-4-brand-inbound.ts`, **new, no flow id yet**)

- [ ] Create in BubbleLab as a webhook, record the id, and point `BRAND_WEBHOOK_URL` at it.
- [ ] **Check the payload contract before anything else.** The field names
      (`contactName`, `brandName`, `email`, `website`, `projectDetails`, `budget`) were taken from
      the **live** flow 9485, i.e. what the website actually posts today. If the site has changed,
      the first real inquiry breaks. Verify against the `stgc-learn` repo.
- [ ] ⛔ **`BOOKING_LINK` is empty**, so no auto-reply is sent (the inquiry is still saved and Sophia
      still notified). Needs the Calendly link.
- [ ] ⬜ `CASE_STUDIES_LINK` is empty; that paragraph is omitted until it is set.
- [ ] ⚠️ **`website` and `budget` have no home.** `BrandLeads` is
      `[lead_id, brand_name, contact_name, email, message, submitted_at, status]` — no column for
      either, though the site sends both. They are currently **folded into `message`** so nothing is
      lost. Decide: leave folded, or add two columns. Nothing else reads `BrandLeads`, so adding is
      low-risk — but it is a schema call, not mine.
- [ ] Validate: a duplicate submit returns `duplicate` and does **not** send a second auto-reply.
- [ ] ⚠️ **Deduping on email alone means a brand can only ever inquire once.** A genuine second
      inquiry months later is silently dropped. Consider whether that is right.
- [ ] ⬜ **Decommission flow 9485** once this is live, or brands get two replies from two systems.

### Flow 5 — warm re-engagement (`flow-5-reengagement.ts`, **structure only**)

- [ ] ⛔ **The ~113 Beacons subscribers do not exist in the `Leads` tab yet.** Until the CSV is
      imported this flow has nobody to email. **Do not run it against a real list until it has been
      validated with test rows.**
- [ ] Create in BubbleLab, cron `0 16 * * 2` (**UTC** = 11am CDT Tuesdays), record the id.
- [ ] Validate with 2–3 hand-added `Leads` rows: send → status moves `New` → `Nurturing` →
      `last_nudged` stamped.
- [ ] Validate the **exclusion**: someone in `Leads` who is also in `Signups` for the live cohort is
      **not** emailed. This is the most embarrassing possible bug in this flow.
- [ ] Validate: a second run does **not** re-email the same lead for the same masterclass, but a
      **new** masterclass does invite them again (the key is cohort-scoped, by design).
- [ ] ⚠️ Nothing ever sets a lead to `Cold`. The status ladder in the brief ends there but no flow
      writes it. Decide who does, and after how many ignored nudges.
- [ ] ⚠️ Weekly cadence (`0 16 * * 2`) is my choice, not a stated requirement. A cold list resents
      daily mail. Confirm.

### Flow 6 — attendance (`flow-6-attendance.ts`, **new, no flow id yet**)

- [ ] Create in BubbleLab as a webhook, record the id.
- [ ] ⚠️ **Built as a webhook/CSV import, not a Zoom API sync — deliberately.** The README's "LSU
      institutional Zoom" blocker is **stale**: `/api/content` now returns a plain
      `zoom.us/j/91498122584` link and Sophia has a brand-owned Zoom login. But **Zoom's
      participant-report API needs a paid plan on the hosting account**, and the tier is unconfirmed.
      → **Confirm the Zoom plan tier and who hosts the meeting.** If it is Pro+, a Zoom pull can
      replace this flow's *input* without touching its matching logic.
- [ ] Validate with a paste of 2–3 addresses: `dryRun: true` previews, `dryRun: false` applies.
- [ ] Validate: re-running the same import changes **nothing** the second time (only rows whose
      value actually differs are written).
- [ ] Validate: an attendee who never registered appears in `unmatched` and is **not** invented as a
      new signup.
- [ ] Note: an **empty** attendee list is rejected rather than marking the whole cohort no-show —
      far more likely a bad paste than a real zero-attendance event.

---

## 2. Cross-cutting

- [ ] ⚠️ **`EmailLog` grows forever** — every person × every sequence × every masterclass, and every
      flow reads the whole tab on every run to answer "already sent?". Fine now (~122 rows). Needs an
      archival story before the funnel is running at volume; it is the one table with no natural bound.
- [ ] ⚠️ **The send fan-out is the real scaling limit, not the reads.** Sends are sequential Resend
      calls inside one execution against a ~2/sec limit and an execution timeout. Capped at
      `MAX_SENDS_PER_RUN = 25` (and `TEST_MODE_MAX_SENDS = 3`). Revisit if a cohort gets large.
- [ ] ⬜ **The `BRAND` object is duplicated in five files.** Accepted for this project's size — but
      if Sophia rebrands, it must be changed in all five.
- [ ] ⬜ **Em dash in approved copy**: `docs/email-pipelines.md:340` (the B2B outreach template) has
      *"Content Velocity — essentially getting you…"* in customer-facing prose. **Left alone
      deliberately** — the brief says not to rewrite approved copy. Sophia's call. Note the automated
      outbound flow strips dashes in code, so nothing ships it today.
- [ ] ⬜ **README caveats are stale** and should be corrected: the midnight-UTC bug and the LSU Zoom
      blocker are both no longer true.

---

## 3. Go-live gate — every box, no exceptions

- [ ] Resend: `shesthatgirl.co` verified → flip `FROM_ADDRESS` to `Sophia <hello@shesthatgirl.co>`
- [ ] Reply-to `hello@shesthatgirl.co` confirmed working
- [ ] Real masterclass date **and time** set at `/admin`
- [ ] ⚠️ **Confirm what `/admin` actually means by the time it stores.** `02:00Z` labelled `CST`
      renders as **9:00 PM CDT**. If the admin UI naively applied a fixed −6 to an "8:00 PM"
      selection, her real intent was **8 PM** and every reminder is an hour off. Undecidable from the
      data — someone has to look.
- [ ] Calendly link → `BOOKING_LINK` (Flow 4) + the Add to Calendar decision (Flows 1/2)
- [ ] Blueprint URL + final price → Flow 3
- [ ] Beacons CSV imported → `Leads`
- [ ] Zoom plan tier + hosting confirmed → Flow 6
- [ ] Physical mailing address added to every footer (**CAN-SPAM requires it; no flow has it today**)
- [ ] Website webhooks repointed and **site redeployed**
- [ ] Old flows 9294 + 9485 **deactivated** (otherwise two systems answer every submission)
- [ ] Test rows purged from `EmailLog` (see the Flow 1 note — they will suppress real sends)
- [ ] Every flow run in BubbleLab with `TEST_MODE = true` and its execution log read
- [ ] Duplicate-send protection validated per flow
- [ ] **Explicit approval from Sophia to go live**
- [ ] Only then: `TEST_MODE = false` in flows 1–5, `DRY_RUN = false` in flow 6 —
      `grep -n 'TEST_MODE = \|DRY_RUN = ' flows/*.ts` to confirm each one
