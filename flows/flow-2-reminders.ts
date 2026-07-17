import {
  BubbleFlow,
  HttpBubble,
  GoogleSheetsBubble,
  ResendBubble,
  type CronEvent,
} from '@bubblelab/bubble-core';

// ---- Config -------------------------------------------------------------
const ENGINE_SHEET_ID = '1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0';
const API_CONTENT_URL = 'https://shesthatgirl.co/api/content';

// SAFETY: while TEST_MODE is true, reminders go ONLY to these inboxes, never a real registrant.
const TEST_MODE = true;
const TEST_RECIPIENTS = ['itismevarnica@gmail.com'];

// Sender identity. Address stays on BubbleLab's system domain until shesthatgirl.co verifies in Resend;
// swap FROM_ADDRESS to "Sophia · She's That Girl Co. <hello@shesthatgirl.co>" after verification.
const FROM_ADDRESS = "She's That Girl Co. <welcome@hello.bubblelab.ai>";
const REPLY_TO = 'hello@shesthatgirl.co';
const UNSUB_MAILTO = 'unsubscribe@shesthatgirl.co';
const DEFAULT_TITLE = "She's That Girl Co. Free Masterclass";

// Cron to set on this flow in BubbleLab (expressions are UTC):  */15 * * * *
// The cadence is not load-bearing: the windows below are wide enough to tolerate drift or a missed
// tick, and EmailLog is what actually guarantees each reminder is sent exactly once.

const SEQ_DAY_BEFORE = 'seq2a';
const SEQ_HOUR_BEFORE = 'seq2b';
const SEQ_IDS: SeqId[] = [SEQ_DAY_BEFORE, SEQ_HOUR_BEFORE];
const SEQUENCE_LABEL = 'seq2';

// Only people who actually registered get reminders. Legacy imports carry masterclass_id
// 'legacy-import' and are excluded by the cohort check anyway.
const REMINDER_STATUSES = ['Registered'];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// How long after the 24h mark the day-before email may still go out. Always additionally clamped to
// local midnight, so it can never land on the day of the class (see windowFor).
const DAY_BEFORE_GRACE_MS = 4 * HOUR_MS;
// The hour-before email opens exactly 60 minutes out, so it is never sent EARLY (which would make
// "We start in 60 minutes" false). Grace is how late it may still go: 30 min survives one skipped
// cron tick. Raising it keeps more people covered but makes the "60 minutes" claim less true.
const HOUR_BEFORE_LEAD_MS = 60 * MINUTE_MS;
const HOUR_BEFORE_GRACE_MS = 30 * MINUTE_MS;

// Sends are sequential Resend calls inside one execution, against a rate limit and an execution
// timeout. Capping per run is what keeps a big cohort from blowing up a single tick; the wide
// day-before window drains any backlog over later ticks for free.
const MAX_SENDS_PER_RUN = 25;
// Under TEST_MODE every reminder goes to ONE inbox, so an uncapped run would fire N near-identical
// emails at the test address and look like spam to Gmail. A small cap still exercises the full
// decision path.
const TEST_MODE_MAX_SENDS = 3;

// A masterclass whose UTC time-of-day is exactly midnight is ambiguous: it is either the old
// "no time was ever set" bug, or a genuine 7:00 PM CDT class. We cannot tell from the value, so we
// refuse to send and let a human decide. Flip to true ONLY after confirming at /admin that the
// midnight-UTC start is intentional.
const ALLOW_MIDNIGHT_UTC_START = false;

// ============================================================================
//  EMAIL COPY  —  Sophia edits ONLY these two blocks to change the reminders.
//  --------------------------------------------------------------------------
//  How to change what registrants receive:
//   * Change the words inside the quotes. That's it.
//   * Keep every {curly token} exactly as written — they auto-fill per registrant:
//       {firstName}  {title}  {date}  {time}  {link}
//   * {time} already includes the correct timezone for that date (for example "9:00 PM CDT"),
//     so do NOT write the timezone yourself.
//   * To add or remove a line, add or remove a line in `bullets` or `paragraphs`.
//   * Do NOT touch buildReminderHtml() below — that is just the styling wrapper.
//  Source of this copy: docs/email-pipelines.md, SEQUENCE 2.
// ============================================================================
const EMAIL_COPY_DAY_BEFORE = {
  subject: 'Tomorrow is your day, girl.',
  heading: 'Tomorrow is your day. 🤍',
  greeting: 'Hey {firstName}!',
  intro: 'Tomorrow we go live and I want you ready.',
  detailsIntro: "Here's a little preview of what we're covering so you know exactly what you're walking into:",
  bullets: [
    "Why brands are literally <i>desperate</i> for content right now and how you can be the one they're paying to create it. No big following required.",
    'How to find your niche and make content that <i>actually</i> converts, not just content that looks pretty.',
    "How to pitch brands and land your first paid deal. We're talking real money, not free products.",
  ],
  paragraphs: [
    "And the mindset shift that makes all of it actually stick. Because trust me, the skill is not the hard part. Deciding you're worth it is.",
    "This is not theory. This is exactly what I did and what's working right now.",
  ],
  ctaLabel: 'Join the Masterclass',
  closing: "Get some sleep. I'll see you tomorrow!",
  signoff: 'Sophia 🤍',
};

const EMAIL_COPY_HOUR_BEFORE = {
  subject: 'We start in 60 minutes',
  heading: 'We start in 60 minutes.',
  greeting: 'Hey {firstName}!',
  intro: "One hour. That's it.",
  detailsIntro: "Don't overthink it. Just show up. That's literally the first step.",
  bullets: [],
  paragraphs: [
    "Grab your notebook and find a quiet spot. What you learn today has the potential to change how you think about money, freedom and what's actually possible for your life.",
  ],
  ctaLabel: 'Join here',
  closing: 'See you in there 🤍',
  signoff: 'Sophia',
};

// Replaces {firstName}/{title}/{date}/{time}/{link} tokens inside any copy string above.
function fill(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k) => tokens[k] ?? '');
}

// ---- Brand tokens (kept in sync with flow-1-signup-confirmation.ts) ------
const BRAND = {
  pageBg: '#F5EDE8', cardBg: '#FFFFFF', headerBg: '#FAF5F2',
  monogram: '#D4756A', monogramText: '#FAF7F5', heading: '#7A5555',
  body: '#4A3F3F', accent: '#A85F5F', softBg: '#FAF5F2', softBorder: '#EADDD5',
  hairline: '#EDD5D5', footer: '#B3A5A5',
  serif: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
  sans: "'Jost', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
};

// ---- Types --------------------------------------------------------------
type SeqId = 'seq2a' | 'seq2b';

interface McSettings { dateIso: string; timezone: string; link: string; }

interface McInfo {
  id: string;
  title: string;
  displayDate: string;
  displayTime: string;
  timezone: string;
  link: string;
  calendarLink: string;
  /** The masterclass start as an absolute instant. Every window is measured from this. */
  startMs: number;
}

type McCheck = { ok: true; mc: McInfo } | { ok: false; reason: string };

interface ReminderTask {
  seq: SeqId;
  firstName: string;
  emailNorm: string;
  key: string;
}

interface Plan {
  due: ReminderTask[];
  expired: ReminderTask[];
  census: Record<string, number>;
}

export interface Output {
  status: string;
  masterclassId?: string;
  reason?: string;
  /** Real registrants a reminder was sent for, even under TEST_MODE where delivery went elsewhere. */
  sent?: string[];
  /** Reminders whose window closed unsent. Recorded once so the miss is visible, never retried. */
  expired?: string[];
  /** Every decision this tick, including the transient ones deliberately kept out of the sheet. */
  census?: Record<string, number>;
  testMode?: boolean;
  message?: string;
}

// ---- Pure helpers (module scope) ----------------------------------------
function normalizeEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

function isValidEmail(emailNorm: string): boolean {
  return emailNorm.length > 0 && emailNorm.includes('@');
}

function emailKey(mcId: string, emailNorm: string, seqId: string): string {
  return `${mcId}:${emailNorm}:${seqId}`;
}

// Parses the /api/content body. The masterclass settings are nested under `stgc_settings`;
// reading the root would silently yield an empty masterclass, so the shape matters.
function parseSettings(bodyText: string): McSettings {
  try {
    const parsed = JSON.parse(bodyText) as { stgc_settings?: { date?: string; timezone?: string; link?: string } };
    const s = parsed.stgc_settings ?? {};
    return { dateIso: s.date ?? '', timezone: s.timezone ?? 'CST', link: s.link ?? '' };
  } catch {
    return { dateIso: '', timezone: '', link: '' };
  }
}

const TZ_MAP: Record<string, string> = {
  CST: 'America/Chicago', CDT: 'America/Chicago',
  EST: 'America/New_York', EDT: 'America/New_York',
  PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  MST: 'America/Denver', MDT: 'America/Denver',
};

// Breaks an instant into its wall-clock parts in a given zone. Used to find local midnight without
// pulling in a date library.
function zonedParts(instantMs: number, iana: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: iana, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(instantMs));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') };
}

// How far ahead of UTC the zone is at this instant (negative in the Americas). Derived from the
// formatted wall clock rather than assumed, so it is correct on either side of a DST switch.
function zoneOffsetMs(instantMs: number, iana: string): number {
  const p = zonedParts(instantMs, iana);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

// Midnight at the START of the local calendar day that `instantMs` falls on. This is the ceiling on
// the day-before window: past it, "tomorrow" has become "today" and the copy would be false.
function localDayStartMs(instantMs: number, iana: string): number {
  const p = zonedParts(instantMs, iana);
  return Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0) - zoneOffsetMs(instantMs, iana);
}

// The gate that decides whether this flow is allowed to email anyone at all. Reminders are timed
// relative to the masterclass start, so anything that makes the start untrustworthy must stop the
// run rather than produce a guess. Unlike Flow 1 (which renders a display string and can afford a
// default), a wrong zone here fires emails hours off, so an unknown label blocks instead of
// defaulting to Central.
function validateMasterclass(s: McSettings, nowMs: number): McCheck {
  if (!s.dateIso) return { ok: false, reason: 'no_date' };

  // A date-only string is the original "no time set" bug's actual signature: new Date('2026-07-17')
  // coerces to midnight UTC. Such a string cannot express a time at all, so blocking it is safe.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.dateIso.trim())) return { ok: false, reason: 'no_time_component' };

  const startMs = Date.parse(s.dateIso);
  if (isNaN(startMs)) return { ok: false, reason: 'unparseable_date' };

  // Genuinely ambiguous: midnight UTC is also 7:00 PM CDT, a plausible class slot. See
  // ALLOW_MIDNIGHT_UTC_START.
  const d = new Date(startMs);
  const isMidnightUtc = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (isMidnightUtc && !ALLOW_MIDNIGHT_UTC_START) return { ok: false, reason: 'suspected_midnight_utc' };

  const label = (s.timezone || '').toUpperCase();
  const iana = TZ_MAP[label];
  if (!iana) return { ok: false, reason: 'unknown_timezone' };

  if (!s.link || !s.link.startsWith('http')) return { ok: false, reason: 'no_link' };
  if (startMs <= nowMs) return { ok: false, reason: 'masterclass_passed' };

  return {
    ok: true,
    mc: {
      id: d.toLocaleDateString('en-CA', { timeZone: iana }),
      title: DEFAULT_TITLE,
      displayDate: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: iana }),
      // Carries the zone that is actually in effect on this date, so a July class reads "9:00 PM CDT"
      // rather than the admin's literal "CST" label, which would name an instant an hour off.
      displayTime: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: iana, timeZoneName: 'short' }),
      timezone: label,
      link: s.link,
      calendarLink: '',
      startMs,
    },
  };
}

// Both reminders are anchored to offsets from the start, so no arbitrary "send at 9am" constant is
// invented and each lands at the same civil time as the class itself. Windows have a CLOSE edge:
// exactly-once comes from the EmailLog ledger, so a window only has to be wide enough to be caught.
function windowFor(seq: SeqId, mc: McInfo): { open: number; close: number } {
  const iana = TZ_MAP[mc.timezone] ?? 'America/Chicago';
  if (seq === SEQ_DAY_BEFORE) {
    const open = mc.startMs - DAY_MS;
    // The local-midnight clamp is the load-bearing part: a pure offset window would spill onto the
    // day of the class, where "Tomorrow is your day" is simply untrue.
    const close = Math.min(open + DAY_BEFORE_GRACE_MS, localDayStartMs(mc.startMs, iana));
    return { open, close };
  }
  const open = mc.startMs - HOUR_BEFORE_LEAD_MS;
  return { open, close: open + HOUR_BEFORE_GRACE_MS };
}

// Finds this masterclass's row in the Masterclasses tab. Absence is not an error: Flow 1 creates
// the row on the first signup, so a cohort with no registrants yet simply has none.
function masterclassRow(values: string[][], id: string): string[] | null {
  for (let i = 1; i < values.length; i++) {
    const row = values[i] ?? [];
    if ((row[0] ?? '') === id) return row;
  }
  return null;
}

function statusOf(row: string[] | null): string {
  return (row?.[7] ?? '').trim().toLowerCase();
}

function calendarLinkOf(row: string[] | null): string {
  return (row?.[6] ?? '').trim();
}

// EmailLog column D holds the full composite key, so "already sent?" is one exact match.
function buildLogKeySet(values: string[][]): Set<string> {
  const keys = new Set<string>();
  for (let i = 1; i < values.length; i++) {
    const k = values[i]?.[3] ?? '';
    if (k) keys.add(k);
  }
  return keys;
}

// The whole eligibility decision, as one pure function of (rows, ledger, masterclass, now). With no
// local runtime to test against, keeping this side-effect free is what makes the exactly-once
// behaviour reviewable by reading it: any `now` can be traced against any ledger state by eye.
function buildPlan(signups: string[][], logKeys: Set<string>, mc: McInfo, nowMs: number, maxSends: number): Plan {
  const due: ReminderTask[] = [];
  const expired: ReminderTask[] = [];
  const census: Record<string, number> = {};
  const seen = new Set<string>();
  const bump = (k: string): void => { census[k] = (census[k] ?? 0) + 1; };

  for (let i = 1; i < signups.length; i++) {
    const row = signups[i] ?? [];
    if ((row[1] ?? '') !== mc.id) { bump('not_this_cohort'); continue; }
    if (!REMINDER_STATUSES.includes(row[7] ?? '')) { bump('status_excluded'); continue; }

    const emailNorm = normalizeEmail(row[3] ?? '');
    if (!isValidEmail(emailNorm)) { bump('invalid_email'); continue; }
    const firstName = (row[2] ?? '').trim() || 'there';

    for (const seq of SEQ_IDS) {
      const key = emailKey(mc.id, emailNorm, seq);

      // Guards against a duplicate Signups row producing two emails in one tick.
      if (seen.has(key)) { bump('duplicate_row'); continue; }
      seen.add(key);

      // Ledger checks come FIRST, before the window checks. An email already sent inside its window
      // must never be re-evaluated once that window closes, or it would collect an :expired row too.
      if (logKeys.has(key)) { bump('already_sent'); continue; }
      if (logKeys.has(`${key}:expired`)) { bump('expired_recorded'); continue; }

      const w = windowFor(seq, mc);
      if (nowMs < w.open) { bump('not_yet_due'); continue; }
      // Window closed unsent. Suppress rather than send late: both of these emails assert a time,
      // and a false one is worse than silence given Flow 1 already delivered the real details.
      if (nowMs >= w.close) { expired.push({ seq, firstName, emailNorm, key }); bump('window_missed'); continue; }
      if (due.length >= maxSends) { bump('deferred'); continue; }

      due.push({ seq, firstName, emailNorm, key });
      bump('due');
    }
  }
  return { due, expired, census };
}

// Branded reminder. This is only the STYLING wrapper — to change the words, edit the EMAIL_COPY
// blocks at the top of the file, not here.
function buildReminderHtml(copy: typeof EMAIL_COPY_DAY_BEFORE, firstName: string, mc: McInfo): string {
  const tokens: Record<string, string> = {
    firstName, title: mc.title, date: mc.displayDate, time: mc.displayTime, link: mc.link,
  };
  const bulletItems = copy.bullets.length > 0
    ? `<ul style="margin:0 0 16px;padding-left:20px;">${copy.bullets.map((b) => `<li style="margin:0 0 8px;">${fill(b, tokens)}</li>`).join('')}</ul>`
    : '';
  const bodyParagraphs = copy.paragraphs
    .map((p) => `<p style="margin:0 0 16px;">${fill(p, tokens)}</p>`)
    .join('\n        ');
  // Rendered only when a calendar link actually exists. Nothing populates Masterclasses.calendar_link
  // yet, so inventing a URL here would ship a broken button.
  const calendarRow = mc.calendarLink
    ? `<p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Add to calendar</span> &nbsp;·&nbsp; <a href="${mc.calendarLink}" style="color:${BRAND.accent};">Save your spot</a></p>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet"></head>
  <body style="margin:0;padding:0;background:${BRAND.pageBg};">
  <div style="background:${BRAND.pageBg};padding:28px 16px;font-family:${BRAND.sans};">
    <div style="max-width:560px;margin:0 auto;background:${BRAND.cardBg};border:1px solid ${BRAND.hairline};border-radius:18px;overflow:hidden;">
      <div style="background:${BRAND.headerBg};text-align:center;padding:30px 24px 22px;border-bottom:1px solid ${BRAND.hairline};">
        <div style="width:54px;height:54px;line-height:54px;border-radius:15px;background:${BRAND.monogram};color:${BRAND.monogramText};font-family:${BRAND.serif};font-style:italic;font-weight:600;font-size:34px;display:inline-block;text-align:center;">S</div>
        <div style="margin-top:12px;font-family:${BRAND.sans};font-size:12px;letter-spacing:3px;color:${BRAND.heading};font-weight:600;">SHE'S THAT GIRL CO.</div>
      </div>
      <div style="padding:34px 34px 12px;color:${BRAND.body};font-size:15px;line-height:1.65;">
        <h1 style="font-family:${BRAND.serif};font-weight:600;color:${BRAND.heading};font-size:30px;margin:0 0 6px;">${fill(copy.heading, tokens)}</h1>
        <p style="margin:0 0 16px;">${fill(copy.greeting, tokens)}</p>
        <p style="margin:0 0 16px;">${fill(copy.intro, tokens)}</p>
        <p style="margin:0 0 10px;">${fill(copy.detailsIntro, tokens)}</p>
        ${bulletItems}
        ${bodyParagraphs}
        <div style="background:${BRAND.softBg};border:1px solid ${BRAND.softBorder};border-radius:14px;padding:20px 22px;margin:6px 0 22px;">
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Date</span> &nbsp;·&nbsp; ${mc.displayDate}</p>
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Time</span> &nbsp;·&nbsp; ${mc.displayTime}</p>
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Your link</span> &nbsp;·&nbsp; <a href="${mc.link}" style="color:${BRAND.accent};">${mc.link}</a></p>
          ${calendarRow}
        </div>
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${mc.link}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-family:${BRAND.sans};font-weight:600;font-size:14px;letter-spacing:.5px;text-decoration:none;padding:13px 32px;border-radius:999px;">${fill(copy.ctaLabel, tokens)}</a>
        </div>
        <p style="margin:0 0 16px;">${fill(copy.closing, tokens)}</p>
        <p style="font-family:${BRAND.serif};font-style:italic;font-size:22px;color:${BRAND.heading};margin:8px 0 2px;">${fill(copy.signoff, tokens)}</p>
      </div>
      <div style="padding:22px 34px 28px;border-top:1px solid ${BRAND.hairline};margin-top:18px;">
        <p style="color:${BRAND.footer};font-size:11.5px;line-height:1.6;margin:0;">
          <b style="color:${BRAND.heading};">She's That Girl Co.</b><br>
          <a href="https://shesthatgirl.co" style="color:${BRAND.footer};">shesthatgirl.co</a> &nbsp;·&nbsp; hello@shesthatgirl.co<br>
          You're receiving this because you registered for a free masterclass.<br>
          <a href="mailto:${UNSUB_MAILTO}?subject=Unsubscribe" style="color:${BRAND.footer};text-decoration:underline;">Unsubscribe</a>
        </p>
      </div>
    </div>
  </div></body></html>`;
}

export class StgcReminderFlow extends BubbleFlow<'schedule/cron'> {
  // Cron expressions are UTC. Every 15 minutes. The cadence is not load-bearing: the windows are wide enough to
  // tolerate drift or a missed tick, and EmailLog is what guarantees exactly-once.
  readonly cronSchedule = '*/15 * * * *';

  // The payload is unused (this flow takes no inputs; everything comes from /api/content and the
  // sheet) but BubbleLab's validator requires a CronEvent parameter on a schedule/cron trigger.
  async handle(payload: CronEvent): Promise<Output> {
    // One instant for the whole run, so every signup is judged against the same clock. Never derive
    // "now" from the cron's nominal fire time, which can drift from actual execution.
    const nowMs = Date.now();

    const contentRes = await this.fetchContent();
    if (!contentRes.success) {
      return { status: 'blocked', reason: 'content_fetch_failed', message: 'Could not read /api/content. No reminders sent.' };
    }
    const bodyText = (contentRes.data?.body ?? '') as string;
    const check = validateMasterclass(parseSettings(bodyText), nowMs);
    if (!check.ok) {
      // Nothing below this point runs, so no send bubble is even constructed on a blocked tick.
      return { status: 'blocked', reason: check.reason, message: 'Masterclass timing unusable. No reminders sent.' };
    }
    const base = check.mc;

    const mcRead = await this.readMasterclasses();
    if (!mcRead.success) {
      return { status: 'blocked', reason: 'masterclasses_read_failed', masterclassId: base.id, message: 'Could not read Masterclasses. No reminders sent.' };
    }
    // Honouring the status column gives Sophia a kill switch in a spreadsheet cell: setting a
    // masterclass to cancelled/done stops a 15-minute cron without a code change. A missing row is
    // not an error here — creating it is Flow 1's job.
    const mcValues = (mcRead.data?.values ?? []) as string[][];
    const mcRow = masterclassRow(mcValues, base.id);
    const mcStatus = statusOf(mcRow);
    if (mcStatus === 'cancelled' || mcStatus === 'done') {
      return { status: 'blocked', reason: `masterclass_${mcStatus}`, masterclassId: base.id, message: 'Masterclass is not active. No reminders sent.' };
    }
    // The calendar link is whatever the sheet holds; when it is blank the email omits that line
    // entirely rather than rendering a dead button.
    const mc: McInfo = { ...base, calendarLink: calendarLinkOf(mcRow) };

    const suRead = await this.readSignups();
    if (!suRead.success) {
      return { status: 'blocked', reason: 'signups_read_failed', masterclassId: mc.id, message: 'Could not read Signups. No reminders sent.' };
    }
    // A failed EmailLog read would make every reminder look unsent and re-send the whole cohort, so
    // it blocks rather than degrading to an empty ledger.
    const logRead = await this.readEmailLog();
    if (!logRead.success) {
      return { status: 'blocked', reason: 'emaillog_read_failed', masterclassId: mc.id, message: 'Could not read EmailLog. No reminders sent.' };
    }

    const suValues = (suRead.data?.values ?? []) as string[][];
    const logKeys = buildLogKeySet((logRead.data?.values ?? []) as string[][]);
    const maxSends = TEST_MODE ? TEST_MODE_MAX_SENDS : MAX_SENDS_PER_RUN;
    const plan = buildPlan(suValues, logKeys, mc, nowMs, maxSends);

    // The loop lives here because BubbleLab forbids a private method calling another private method.
    const sent: string[] = [];
    for (const task of plan.due) {
      const recipients = TEST_MODE ? TEST_RECIPIENTS : [task.emailNorm];
      // Written as an if/else rather than a ternary: BubbleLab cannot instrument a method call that
      // sits inside a ternary, and rejects the flow at validation.
      let sendOk = false;
      if (task.seq === SEQ_DAY_BEFORE) {
        const dayBeforeRes = await this.sendDayBefore(task.firstName, mc, recipients);
        sendOk = dayBeforeRes.success;
      } else {
        const hourBeforeRes = await this.sendHourBefore(task.firstName, mc, recipients);
        sendOk = hourBeforeRes.success;
      }
      // Appending per send (not once at the end) bounds a mid-run crash to one duplicate email
      // rather than the whole batch.
      await this.appendEmailLog(mc.id, task, sendOk ? task.key : `${task.key}:failed`);
      if (sendOk) sent.push(`${task.emailNorm}:${task.seq}`);
    }

    for (const task of plan.expired) {
      await this.appendEmailLog(mc.id, task, `${task.key}:expired`);
    }

    return {
      status: 'ok',
      masterclassId: mc.id,
      sent,
      expired: plan.expired.map((t) => `${t.emailNorm}:${t.seq}`),
      census: plan.census,
      testMode: TEST_MODE,
    };
  }

  // Fetches the live site content (as text) so we can read the current masterclass settings.
  private async fetchContent() {
    const contentFetcher = new HttpBubble({ url: API_CONTENT_URL, method: 'GET', responseType: 'text' });
    return await contentFetcher.action();
  }

  // Reads the Masterclasses tab, which carries the status column used as the manual kill switch.
  private async readMasterclasses() {
    const masterclassReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Masterclasses' });
    return await masterclassReader.action();
  }

  // Reads the Signups tab; every registrant of the active cohort is a reminder candidate.
  private async readSignups() {
    const signupsReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Signups' });
    return await signupsReader.action();
  }

  // Reads the EmailLog tab. This is the ledger that makes a 15-minute cron safe: without it every
  // tick would resend.
  private async readEmailLog() {
    const emailLogReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'EmailLog' });
    return await emailLogReader.action();
  }

  // Records the outcome of one reminder. A success writes the bare key; a failure writes ':failed'
  // and an unsent-but-closed window writes ':expired', neither of which match the "already sent"
  // lookup, so a failure is retried on the next tick while an expiry is recorded once and left alone.
  // Column B always holds the real registrant, even under TEST_MODE when delivery went elsewhere.
  private async appendEmailLog(mcId: string, task: ReminderTask, key: string) {
    const reminderLogWriter = new GoogleSheetsBubble({
      operation: 'append_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'EmailLog!A1',
      values: [[`${mcId}:${task.emailNorm}`, task.emailNorm, SEQUENCE_LABEL, key, new Date().toISOString()]],
      value_input_option: 'RAW', insert_data_option: 'INSERT_ROWS',
    });
    return await reminderLogWriter.action();
  }

  // Sends the day-before reminder. Recipients are the safe test inboxes while TEST_MODE is on.
  // Subject and body come from EMAIL_COPY_DAY_BEFORE at the top of the file.
  private async sendDayBefore(firstName: string, mc: McInfo, recipients: string[]) {
    const tokens: Record<string, string> = { firstName, title: mc.title, date: mc.displayDate, time: mc.displayTime, link: mc.link };
    const dayBeforeMailer = new ResendBubble({
      operation: 'send_email', from: FROM_ADDRESS, reply_to: REPLY_TO, to: recipients,
      subject: fill(EMAIL_COPY_DAY_BEFORE.subject, tokens),
      html: buildReminderHtml(EMAIL_COPY_DAY_BEFORE, firstName, mc),
      headers: { 'List-Unsubscribe': `<mailto:${UNSUB_MAILTO}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    return await dayBeforeMailer.action();
  }

  // Sends the one-hour-before reminder. Subject and body come from EMAIL_COPY_HOUR_BEFORE.
  private async sendHourBefore(firstName: string, mc: McInfo, recipients: string[]) {
    const tokens: Record<string, string> = { firstName, title: mc.title, date: mc.displayDate, time: mc.displayTime, link: mc.link };
    const hourBeforeMailer = new ResendBubble({
      operation: 'send_email', from: FROM_ADDRESS, reply_to: REPLY_TO, to: recipients,
      subject: fill(EMAIL_COPY_HOUR_BEFORE.subject, tokens),
      html: buildReminderHtml(EMAIL_COPY_HOUR_BEFORE, firstName, mc),
      headers: { 'List-Unsubscribe': `<mailto:${UNSUB_MAILTO}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    return await hourBeforeMailer.action();
  }
}
