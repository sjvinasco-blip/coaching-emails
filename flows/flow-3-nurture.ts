import {
  BubbleFlow,
  GoogleSheetsBubble,
  ResendBubble,
  type CronEvent,
} from '@bubblelab/bubble-core';

// ---- Config -------------------------------------------------------------
const ENGINE_SHEET_ID = '1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0';

// SAFETY: while TEST_MODE is true, nurture emails go ONLY to these inboxes, never a real registrant.
const TEST_MODE = true;
const TEST_RECIPIENTS = ['itismevarnica@gmail.com'];

const FROM_ADDRESS = "She's That Girl Co. <welcome@hello.bubblelab.ai>";
const REPLY_TO = 'hello@shesthatgirl.co';
const UNSUB_MAILTO = 'unsubscribe@shesthatgirl.co';

// Cron to set on this flow in BubbleLab (expressions are UTC):  0 15 * * *   (10:00 AM CDT)
// Daily. Each email is pinned to a whole-day offset from the cohort date, so the exact hour only
// decides what time of day people hear from Sophia; EmailLog guarantees exactly-once.

const SEQUENCE_LABEL = 'seq3';
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// Only registrants get nurtured. Legacy imports carry masterclass_id 'legacy-import' and never
// match a real cohort id anyway.
const NURTURE_STATUSES = ['Registered', 'Attended', 'No-show'];

// Values in Signups.attended that mean "this person was there". Flow 6 writes this column.
const ATTENDED_VALUES = ['yes', 'true', 'attended', '1'];

const MAX_SENDS_PER_RUN = 25;
// Under TEST_MODE every email goes to ONE inbox, so an uncapped run would fire N near-identical
// emails at the test address and look like spam to Gmail.
const TEST_MODE_MAX_SENDS = 3;

// ============================================================================
//  OFFERS AND LINKS  —  these gate whether an email may send at all.
//  --------------------------------------------------------------------------
//  An email whose copy points at an offer cannot go out until that offer has a real URL. Leaving
//  one blank does not send a broken link; it blocks that email and reports why. Fill these in and
//  the corresponding emails start sending.
// ============================================================================
// The UGC Business Blueprint. docs/email-pipelines.md lists the price as $26 (Notion also says
// $26.99) and the project brief says $29 — all three disagree, so the price in the copy below is
// whatever docs/email-pipelines.md says and needs confirming before go-live.
const BLUEPRINT_URL = '';
// STGC Creator Network / Academy application. This one is known.
const CREATOR_NETWORK_URL = 'https://form.typeform.com/to/XvUDphpd';

// ============================================================================
//  EMAIL COPY  —  Sophia edits ONLY these blocks to change the nurture emails.
//  --------------------------------------------------------------------------
//   * Change the words inside the quotes. That's it.
//   * Keep every {curly token} exactly as written: {firstName} {offerLink}
//   * To add or remove a line, add or remove a line in `paragraphs`.
//   * Do NOT touch buildNurtureHtml() below — that is just the styling wrapper.
//  Source of this copy: docs/email-pipelines.md, SEQUENCE 3. All five approved emails are kept
//  here; ACTIVE_SEQUENCE below decides which ones actually send.
// ============================================================================
const EMAIL_COPY_DAY0 = {
  subject: 'Thank you for showing up for yourself.',
  heading: 'Thank you for showing up. 🤍',
  greeting: 'Hey {firstName},',
  paragraphs: [
    'I just want to say thank you. Genuinely.',
    "Not everyone who signs up actually shows up. You did. And that matters more than you know because it tells me something about you. You're serious. You want this.",
    "Here's a quick recap so you can come back to this whenever you need a reminder of what's possible:",
    'The UGC opportunity is real and it\'s right now. Brands are actively looking for women to create content for them and they don\'t care how many followers you have. They care about <i>your</i> content.',
    "Your niche doesn't need to be perfect. It just needs to be a start. The women winning in this space are the ones who started messy and figured it out as they went.",
    "Pitching brands isn't about begging. When you understand what a brand actually needs, which is conversions (not just cute content), the whole conversation changes.",
    "And the mindset work is not optional. Everything I've built started with deciding I was no longer <b>willing</b> to stay stuck. That decision is available to you too.",
    "If you're ready to take what you learned today and actually do something with it, I put together the UGC Business Blueprint for exactly this moment. It's $26 and it walks you through finding your niche, building your portfolio from scratch and landing your first brand deal.",
  ],
  ctaLabel: 'Grab the UGC Business Blueprint',
  closing: "No pressure. But if today lit something up in you, don't let that feeling fade without doing something with it.",
  signoff: 'So proud of you for showing up 🤍<br>Sophia',
  ps: '',
};

const EMAIL_COPY_DAY2 = {
  subject: 'The version of me nobody saw coming.',
  heading: 'The version of me nobody saw coming.',
  greeting: 'Hey {firstName},',
  paragraphs: [
    "I want to share something with you today that I don't talk about enough.",
    'There was a version of me that genuinely believed she was meant to struggle. That financial freedom was for other people. People with the right connections, the right background, the right everything. Not me.',
    'I was working hard. Doing what I was supposed to do. And still felt completely stuck.',
    "What changed wasn't a big moment. It wasn't one viral video or one brand deal that fixed everything.",
    'It was a decision.',
    'I decided to stop waiting until I felt ready. Stop waiting until I had more followers. Stop waiting for the timing to be perfect. And just start.',
    'I started documenting. I started reaching out. I started treating my creativity like a business instead of a hobby. And slowly everything shifted.',
    "Brands started saying yes. Income started coming in. Women started asking how I was doing it. I built She's That Girl Co. from the ground up, the first female-centric UGC agency, not because I had it all figured out but because I refused to let fear make my decisions for me anymore.",
    "I'm telling you this because I know what it feels like to look at someone else's life and think that's not for me.",
    'It is for you. I promise.',
    "I'm not going to pitch you anything today. I just wanted you to know who you're learning from and why I built this for women like you.",
  ],
  ctaLabel: '',
  closing: 'More coming tomorrow 🤍',
  signoff: 'Sophia',
  ps: "P.S. Hit reply and tell me what's the one thing holding you back right now. I read every single one.",
};

const EMAIL_COPY_DAY3 = {
  subject: "She didn't have a following either.",
  heading: "She didn't have a following either.",
  greeting: 'Hey {firstName},',
  paragraphs: [
    'The women seeing results from this are not special. They didn\'t have a big audience. They didn\'t have experience. They just decided to start and they had a roadmap and the right connections.',
    'That roadmap is access to our <i>recently launched</i> creator network.',
    'For a monthly fee, I give you access to <i>real</i> paid brand campaigns - if you are a creator looking to break into the industry, this one is for you. Plus, access to this exclusive internal network also means access to our She\'s That Girl Co. Academy, which includes:',
    '10+ learning modules created by yours truly.',
    'Access to several free downloadable resources that actually help you succeed.',
    'Weekly group coaching calls - an intimate environment where we can all thrive, learn, and connect.',
    "This is not a 47-module course you'll never finish. It's a lean, actionable community to fast-track your way to success.",
    'The investment is $99.99 per month. One brand deal will cover the investment x10. Staying stuck costs a lot more than that.',
  ],
  ctaLabel: 'Apply for the creator program',
  closing: '',
  signoff: 'Sophia 🤍',
  ps: '',
};

const EMAIL_COPY_DAY5 = {
  subject: "Let me guess what you're thinking.",
  heading: "Let me guess what you're thinking.",
  greeting: 'Hey {firstName},',
  paragraphs: [
    'I hear it all the time. And honestly? I said every single one of these to myself before I started.',
    'So let me talk to you directly.',
    '<b>"I don\'t have time."</b>',
    "Girl, I get it. You're working full time, maybe managing a whole household, maybe both. But here's the truth: UGC does not require 8 hours a day. It requires consistency. Women on my roster are landing deals working 5 to 10 hours a week. The question is not whether you have time. It's whether you're willing to trade some Netflix hours for income hours, at least for now.",
    '<b>"I don\'t have a big following."</b>',
    'This is the biggest myth in this entire industry. Brands who hire UGC creators are not paying for your audience. They are paying for your content. Your ability to make authentic, relatable, converting video. That is the product. I have seen women with 200 followers land $500 deals. Your follower count is not the barrier. Your belief is.',
    '<b>"I\'ve tried something like this before and it didn\'t work."</b>',
    'Then you didn\'t have the right strategy. Or you quit before momentum built. Or you were trying to figure it out alone without a real framework. This is different because you have the system, the community and someone who is actively building this and documenting every step in real time.',
    'If any of that hit home, the STGC Creator Network is still available for $99.99',
  ],
  ctaLabel: 'Get it here',
  closing: "You've been thinking about this long enough 🤍",
  signoff: 'Sophia',
  ps: '',
};

const EMAIL_COPY_DAY7 = {
  subject: 'Last call. And something else I want to say.',
  heading: 'Last call.',
  greeting: 'Hey {firstName},',
  paragraphs: [
    "This is the last time I'll bring up the STGC Creator Academy for $99.99 per month.",
    "If you've been sitting on the fence, this is your sign. Get it, go through it, take one action from it this week. That's all I'm asking.",
    'Now I want to talk to a specific group of you.',
    "Some of you have been reading these emails thinking I don't just want the guide. I want someone in my corner, but I'm not ready for a larger investment yet. I want to actually be walked through this.",
    "That's what my exclusive, academy-only access option is for.",
    'I work with women one on one to get clear on their niche and positioning, build their UGC portfolio and outreach strategy, land their first brand deals with real confidence and scale into something sustainable on their terms - the STGC Creator Network offers all of this too - the only difference is, you\'re not put in front of paid opportunities right away.',
    'This is me with you, helping you build.',
    "If you're ready for that level of support, reply to this email with the word READY and I'll send you all the details.",
    'No pressure. No hard sell. Just an open door for the women who are serious.',
  ],
  ctaLabel: 'Apply before it closes',
  closing: "Either way I'm rooting for you. I mean that.",
  signoff: 'Sophia 🤍',
  ps: '',
};

// ---- Types --------------------------------------------------------------
type NurtureCopy = typeof EMAIL_COPY_DAY0;

interface NurtureStep {
  id: string;
  /** Whole days after the cohort's local calendar date that this email goes out. */
  dayOffset: number;
  /** True when the copy asserts the person attended, so it must not go to a no-show. */
  requiresAttendance: boolean;
  /** The offer URL this email's CTA points at. Empty blocks the email rather than shipping a dead link. */
  offerUrl: string;
  copy: NurtureCopy;
}

// Offsets come from docs/email-pipelines.md: same day, day 2, day 3, day 5, day 7.
const SEQUENCE: NurtureStep[] = [
  { id: 'seq3_day0', dayOffset: 0, requiresAttendance: true, offerUrl: BLUEPRINT_URL, copy: EMAIL_COPY_DAY0 },
  { id: 'seq3_day2', dayOffset: 2, requiresAttendance: false, offerUrl: '', copy: EMAIL_COPY_DAY2 },
  { id: 'seq3_day3', dayOffset: 3, requiresAttendance: false, offerUrl: CREATOR_NETWORK_URL, copy: EMAIL_COPY_DAY3 },
  { id: 'seq3_day5', dayOffset: 5, requiresAttendance: false, offerUrl: CREATOR_NETWORK_URL, copy: EMAIL_COPY_DAY5 },
  { id: 'seq3_day7', dayOffset: 7, requiresAttendance: false, offerUrl: CREATOR_NETWORK_URL, copy: EMAIL_COPY_DAY7 },
];

// ============================================================================
//  WHICH EMAILS ACTUALLY SEND
//  --------------------------------------------------------------------------
//  Sophia's note on docs/email-pipelines.md: "reduce to 1-3 emails in the 3rd sequence". All five
//  approved emails stay above so nothing is lost; this list decides which ones go out. The default
//  is a first guess, NOT Sophia's decision, and needs her confirmation:
//    seq3_day0 - the thank-you plus the $26 Blueprint (the low-cost offer)
//    seq3_day3 - the Creator Network at $99.99 (the main offer)
//    seq3_day5 - the objections email, which she singled out: "if I have to choose between this one
//                and the next one, I choose this one"
//  To change the trim, edit this one line. No copy needs to move.
// ============================================================================
const ACTIVE_SEQUENCE = ['seq3_day0', 'seq3_day3', 'seq3_day5'];

interface NurtureTask {
  stepId: string;
  mcId: string;
  firstName: string;
  emailNorm: string;
  key: string;
}

interface Plan {
  due: NurtureTask[];
  census: Record<string, number>;
}

export interface Output {
  status: string;
  /** Real registrants an email was sent for, even under TEST_MODE where delivery went elsewhere. */
  sent?: string[];
  /** Every decision this run, including transient ones deliberately kept out of the sheet. */
  census?: Record<string, number>;
  /** Emails that are switched on but cannot send because their offer URL is still blank. */
  blockedSteps?: string[];
  testMode?: boolean;
  message?: string;
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

const TZ_MAP: Record<string, string> = {
  CST: 'America/Chicago', CDT: 'America/Chicago',
  EST: 'America/New_York', EDT: 'America/New_York',
  PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  MST: 'America/Denver', MDT: 'America/Denver',
};

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

function fill(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k) => tokens[k] ?? '');
}

function buildLogKeySet(values: string[][]): Set<string> {
  const keys = new Set<string>();
  for (let i = 1; i < values.length; i++) {
    const k = values[i]?.[3] ?? '';
    if (k) keys.add(k);
  }
  return keys;
}

// Whole days between two YYYY-MM-DD calendar dates. Both are plain dates, so anchoring them at UTC
// midnight makes the difference exact and immune to the zone either was produced in.
function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return NaN;
  return Math.round((b - a) / DAY_MS);
}

// A cohort id IS its local calendar date, so the nurture offsets need no /api/content lookup and no
// stored timestamp. The zone only decides when "today" rolls over.
function cohortsInWindow(mcValues: string[][], nowMs: number, maxOffset: number): Map<string, number> {
  const offsets = new Map<string, number>();
  for (let i = 1; i < mcValues.length; i++) {
    const row = mcValues[i] ?? [];
    const id = (row[0] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) continue;
    const status = (row[7] ?? '').trim().toLowerCase();
    if (status === 'cancelled') continue;
    const iana = TZ_MAP[(row[4] ?? '').trim().toUpperCase()] ?? 'America/Chicago';
    const todayIso = new Date(nowMs).toLocaleDateString('en-CA', { timeZone: iana });
    const offset = daysBetweenIsoDates(id, todayIso);
    if (isNaN(offset) || offset < 0 || offset > maxOffset) continue;
    offsets.set(id, offset);
  }
  return offsets;
}

function isAttended(raw: string): boolean {
  return ATTENDED_VALUES.includes((raw || '').trim().toLowerCase());
}

// The whole eligibility decision as one pure function. Side-effect free on purpose: with no local
// runtime, this is the only part whose exactly-once behaviour can be checked by reading it.
function buildPlan(
  signups: string[][],
  logKeys: Set<string>,
  offsets: Map<string, number>,
  activeSteps: NurtureStep[],
  maxSends: number,
): Plan {
  const due: NurtureTask[] = [];
  const census: Record<string, number> = {};
  const seen = new Set<string>();
  const bump = (k: string): void => { census[k] = (census[k] ?? 0) + 1; };

  for (let i = 1; i < signups.length; i++) {
    const row = signups[i] ?? [];
    const mcId = (row[1] ?? '').trim();
    const offset = offsets.get(mcId);
    if (offset === undefined) { bump('cohort_not_in_window'); continue; }
    if (!NURTURE_STATUSES.includes(row[7] ?? '')) { bump('status_excluded'); continue; }

    const emailNorm = normalizeEmail(row[3] ?? '');
    if (!isValidEmail(emailNorm)) { bump('invalid_email'); continue; }
    const firstName = (row[2] ?? '').trim() || 'there';
    const attended = isAttended(row[8] ?? '');

    for (const step of activeSteps) {
      if (step.dayOffset !== offset) continue;

      const key = emailKey(mcId, emailNorm, step.id);
      if (seen.has(key)) { bump('duplicate_row'); continue; }
      seen.add(key);

      // Ledger first: a send already on record is never reconsidered.
      if (logKeys.has(key)) { bump('already_sent'); continue; }

      // This email's copy tells the reader "you showed up", so it must not reach a no-show, and it
      // must not go out before anyone knows who showed up. Requiring attendance data covers both:
      // until Flow 6 populates the column, this email simply does not send.
      if (step.requiresAttendance && !attended) { bump('not_attended_or_unknown'); continue; }

      if (due.length >= maxSends) { bump('deferred'); continue; }
      due.push({ stepId: step.id, mcId, firstName, emailNorm, key });
      bump('due');
    }
  }
  return { due, census };
}

function stepById(id: string): NurtureStep | undefined {
  return SEQUENCE.find((s) => s.id === id);
}

// Branded nurture email. This is only the STYLING wrapper — to change the words, edit the EMAIL_COPY
// blocks at the top of the file, not here.
function buildNurtureHtml(copy: NurtureCopy, firstName: string, offerUrl: string): string {
  const tokens: Record<string, string> = { firstName, offerLink: offerUrl };
  const bodyParagraphs = copy.paragraphs
    .map((p) => `<p style="margin:0 0 16px;">${fill(p, tokens)}</p>`)
    .join('\n        ');
  const cta = copy.ctaLabel && offerUrl
    ? `<div style="text-align:center;margin:0 0 24px;">
          <a href="${offerUrl}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-family:${BRAND.sans};font-weight:600;font-size:14px;letter-spacing:.5px;text-decoration:none;padding:13px 32px;border-radius:999px;">${fill(copy.ctaLabel, tokens)}</a>
        </div>`
    : '';
  const closing = copy.closing ? `<p style="margin:0 0 16px;">${fill(copy.closing, tokens)}</p>` : '';
  const ps = copy.ps ? `<p style="color:#8a7d7d;font-size:13px;margin:14px 0 0;">${fill(copy.ps, tokens)}</p>` : '';
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
        ${bodyParagraphs}
        ${cta}
        ${closing}
        <p style="font-family:${BRAND.serif};font-style:italic;font-size:22px;color:${BRAND.heading};margin:8px 0 2px;">${fill(copy.signoff, tokens)}</p>
        ${ps}
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

export class StgcNurtureFlow extends BubbleFlow<'schedule/cron'> {
  // Cron expressions are UTC. Daily at 10:00 AM CDT. Each email is pinned to a whole-day offset from the cohort
  // date, so the hour only decides what time of day people hear from Sophia.
  readonly cronSchedule = '0 15 * * *';

  // The payload is unused (this flow takes no inputs) but BubbleLab's validator requires a
  // CronEvent parameter on a schedule/cron trigger.
  async handle(payload: CronEvent): Promise<Output> {
    const nowMs = Date.now();

    const mcRead = await this.readMasterclasses();
    if (!mcRead.success) {
      return { status: 'blocked', message: 'Could not read Masterclasses. No nurture emails sent.' };
    }
    const suRead = await this.readSignups();
    if (!suRead.success) {
      return { status: 'blocked', message: 'Could not read Signups. No nurture emails sent.' };
    }
    // A failed EmailLog read would make every email look unsent and re-send the whole sequence, so
    // it blocks rather than degrading to an empty ledger.
    const logRead = await this.readEmailLog();
    if (!logRead.success) {
      return { status: 'blocked', message: 'Could not read EmailLog. No nurture emails sent.' };
    }

    // An email that is switched on but has no offer URL is reported, not sent with a dead button.
    const activeSteps: NurtureStep[] = [];
    const blockedSteps: string[] = [];
    for (const id of ACTIVE_SEQUENCE) {
      const step = stepById(id);
      if (!step) { blockedSteps.push(`${id}:unknown_step`); continue; }
      if (step.copy.ctaLabel && !step.offerUrl) { blockedSteps.push(`${id}:missing_offer_url`); continue; }
      activeSteps.push(step);
    }

    const mcValues = (mcRead.data?.values ?? []) as string[][];
    const maxOffset = SEQUENCE.reduce((m, s) => (s.dayOffset > m ? s.dayOffset : m), 0);
    const offsets = cohortsInWindow(mcValues, nowMs, maxOffset);

    const suValues = (suRead.data?.values ?? []) as string[][];
    const logKeys = buildLogKeySet((logRead.data?.values ?? []) as string[][]);
    const maxSends = TEST_MODE ? TEST_MODE_MAX_SENDS : MAX_SENDS_PER_RUN;
    const plan = buildPlan(suValues, logKeys, offsets, activeSteps, maxSends);

    // The loop lives here because BubbleLab forbids a private method calling another private method.
    const sent: string[] = [];
    for (const task of plan.due) {
      const step = stepById(task.stepId);
      if (!step) continue;
      const recipients = TEST_MODE ? TEST_RECIPIENTS : [task.emailNorm];
      const sendRes = await this.sendNurture(step.copy, step.offerUrl, task.firstName, recipients);
      // Appending per send bounds a mid-run crash to one duplicate rather than the whole batch.
      await this.appendEmailLog(task, sendRes.success ? task.key : `${task.key}:failed`);
      if (sendRes.success) sent.push(`${task.emailNorm}:${task.stepId}`);
    }

    return {
      status: 'ok',
      sent,
      census: plan.census,
      blockedSteps,
      testMode: TEST_MODE,
    };
  }

  // Reads the Masterclasses tab. Each cohort id is its local date, which is what the day offsets
  // are measured from; the status column lets a cancelled cohort be skipped.
  private async readMasterclasses() {
    const nurtureMasterclassReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Masterclasses' });
    return await nurtureMasterclassReader.action();
  }

  // Reads the Signups tab. The attended column decides who may receive the attendance-only email.
  private async readSignups() {
    const nurtureSignupsReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Signups' });
    return await nurtureSignupsReader.action();
  }

  // Reads the EmailLog tab. This ledger is what stops a daily cron resending yesterday's email.
  private async readEmailLog() {
    const nurtureEmailLogReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'EmailLog' });
    return await nurtureEmailLogReader.action();
  }

  // Records the outcome. A success writes the bare key; a failure writes ':failed', which never
  // matches the "already sent" lookup, so the next daily run retries it.
  // Column B always holds the real registrant, even under TEST_MODE when delivery went elsewhere.
  private async appendEmailLog(task: NurtureTask, key: string) {
    const nurtureLogWriter = new GoogleSheetsBubble({
      operation: 'append_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'EmailLog!A1',
      values: [[`${task.mcId}:${task.emailNorm}`, task.emailNorm, SEQUENCE_LABEL, key, new Date().toISOString()]],
      value_input_option: 'RAW', insert_data_option: 'INSERT_ROWS',
    });
    return await nurtureLogWriter.action();
  }

  // Sends one nurture email. Recipients are the safe test inboxes while TEST_MODE is on. Subject and
  // body come from the EMAIL_COPY blocks at the top of the file.
  private async sendNurture(copy: NurtureCopy, offerUrl: string, firstName: string, recipients: string[]) {
    const nurtureMailer = new ResendBubble({
      operation: 'send_email', from: FROM_ADDRESS, reply_to: REPLY_TO, to: recipients,
      subject: fill(copy.subject, { firstName }),
      html: buildNurtureHtml(copy, firstName, offerUrl),
      headers: { 'List-Unsubscribe': `<mailto:${UNSUB_MAILTO}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    return await nurtureMailer.action();
  }
}
