import {
  BubbleFlow,
  HttpBubble,
  GoogleSheetsBubble,
  ResendBubble,
  type CronEvent,
} from '@bubblelab/bubble-core';

// ============================================================================
//  STATUS: STRUCTURE ONLY. NOT READY FOR A REAL LIST.
//  --------------------------------------------------------------------------
//  The ~113 Beacons subscribers this flow is meant for have not been imported yet. Until the CSV
//  lands in the Leads tab there is nobody to email, and the flow is designed to do nothing rather
//  than guess. Validate it with a couple of hand-added test rows in Leads, never against a real list.
// ============================================================================

// ---- Config -------------------------------------------------------------
const ENGINE_SHEET_ID = '1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0';
const API_CONTENT_URL = 'https://shesthatgirl.co/api/content';
const SIGNUP_PAGE_URL = 'https://learn.shesthatgirl.co/';

// SAFETY: while TEST_MODE is true, re-engagement goes ONLY to these inboxes, never a real lead.
const TEST_MODE = true;
const TEST_RECIPIENTS = ['itismevarnica@gmail.com'];

const FROM_ADDRESS = "She's That Girl Co. <welcome@hello.bubblelab.ai>";
const REPLY_TO = 'hello@shesthatgirl.co';
const UNSUB_MAILTO = 'unsubscribe@shesthatgirl.co';

// Cron to set on this flow in BubbleLab (expressions are UTC):  0 16 * * 2   (11:00 AM CDT Tuesdays)
// Weekly. This is a nudge, not a drip: a cold list resents daily mail, and every send is ledgered
// anyway so the cadence only decides how often a NEW masterclass can be announced.

const SEQUENCE_LABEL = 'seq5';
const SEQ_ID = 'seq5_masterclass_invite';

// Lead statuses this flow will email. Someone who already registered, attended, or went cold is left
// alone: Registered/Attended are handled by Flows 1-3, and Cold means stop.
const NUDGEABLE_STATUSES = ['New', 'Nurturing'];

const MAX_SENDS_PER_RUN = 25;
// Under TEST_MODE every email goes to ONE inbox, so an uncapped run would fire N near-identical
// emails at the test address and look like spam to Gmail.
const TEST_MODE_MAX_SENDS = 3;

// ============================================================================
//  EMAIL COPY  —  Sophia edits ONLY this block.
//  --------------------------------------------------------------------------
//   * Keep every {curly token} exactly as written: {firstName} {link}
//   * Source: docs/email-pipelines.md, "Standalone broadcasts" -> "Beacons -> Masterclass".
// ============================================================================
const EMAIL_COPY = {
  subject: 'I built something new for you',
  heading: 'I built something new for you.',
  greeting: 'Hey {firstName}!',
  paragraphs: [
    "I've been working on something behind the scenes and I'm so excited to finally tell you about it.",
    "If you've been following me for a while you already know I talk a lot about financial freedom, leaving the 9 to 5, and building something that's actually yours. But I realized I was telling you WHAT to do without really showing you HOW.",
    'So I built a free masterclass.',
    "It's called She's That Girl Co. Free Masterclass and it's everything I wish someone had walked me through when I was first starting out. I'm talking about the exact skill that helped me build income on my own terms, how to actually get brands to pay you, and the mindset shift that made all of it possible.",
    'No fluff. No gatekeeping. Just me showing you what works.',
    'I would love to see you there.',
  ],
  ctaLabel: 'Save your spot',
  closing: "It's completely free. You just need your name and email and you're in.",
  paragraphsAfterCta: [
    "I'm doing things a little differently now so you'll be hearing from me through this new home instead of where we were before. Same me, same mission, just a better experience for you.",
    "I'm so glad you're here. Seriously.",
  ],
  signoff: 'Sophia 🤍',
};

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

// ---- Types --------------------------------------------------------------
interface McSettings { dateIso: string; timezone: string; link: string; }

interface NudgeTask {
  rowIndex: number;
  firstName: string;
  emailNorm: string;
  key: string;
}

interface Plan {
  due: NudgeTask[];
  census: Record<string, number>;
}

export interface Output {
  status: string;
  masterclassId?: string;
  reason?: string;
  /** Real leads an email was sent for, even under TEST_MODE where delivery went elsewhere. */
  sent?: string[];
  /** Leads whose status was advanced to Nurturing this run. */
  statusUpdated?: number;
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

function fill(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k) => tokens[k] ?? '');
}

// The masterclass settings are nested under `stgc_settings`; reading the root yields nothing.
function parseSettings(bodyText: string): McSettings {
  try {
    const parsed = JSON.parse(bodyText) as { stgc_settings?: { date?: string; timezone?: string; link?: string } };
    const s = parsed.stgc_settings ?? {};
    return { dateIso: s.date ?? '', timezone: s.timezone ?? '', link: s.link ?? '' };
  } catch {
    return { dateIso: '', timezone: '', link: '' };
  }
}

// This flow only needs to know WHICH masterclass is being advertised, so the cohort id is enough and
// there is no window maths. It still refuses to run without a real, future, parseable date, because
// inviting a cold list to a masterclass that has already happened is worse than staying quiet.
function activeCohortId(s: McSettings, nowMs: number): { ok: true; id: string } | { ok: false; reason: string } {
  if (!s.dateIso) return { ok: false, reason: 'no_date' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.dateIso.trim())) return { ok: false, reason: 'no_time_component' };
  const startMs = Date.parse(s.dateIso);
  if (isNaN(startMs)) return { ok: false, reason: 'unparseable_date' };
  if (startMs <= nowMs) return { ok: false, reason: 'masterclass_passed' };
  const iana = TZ_MAP[(s.timezone || '').toUpperCase()];
  if (!iana) return { ok: false, reason: 'unknown_timezone' };
  return { ok: true, id: new Date(startMs).toLocaleDateString('en-CA', { timeZone: iana }) };
}

function buildLogKeySet(values: string[][]): Set<string> {
  const keys = new Set<string>();
  for (let i = 1; i < values.length; i++) {
    const k = values[i]?.[3] ?? '';
    if (k) keys.add(k);
  }
  return keys;
}

// Everyone already registered for the cohort being advertised. Inviting them again is the single
// most embarrassing thing this flow could do, so the exclusion is built from the Signups tab rather
// than trusted to the Leads status column, which only updates when this flow itself runs.
function registeredEmails(signups: string[][], mcId: string): Set<string> {
  const set = new Set<string>();
  for (let i = 1; i < signups.length; i++) {
    const row = signups[i] ?? [];
    if ((row[1] ?? '').trim() !== mcId) continue;
    const e = normalizeEmail(row[3] ?? '');
    if (e) set.add(e);
  }
  return set;
}

// The whole eligibility decision as one pure function. rowIndex is carried so the status write can
// target that exact row instead of rewriting the tab.
function buildPlan(
  leads: string[][],
  logKeys: Set<string>,
  registered: Set<string>,
  mcId: string,
  maxSends: number,
): Plan {
  const due: NudgeTask[] = [];
  const census: Record<string, number> = {};
  const seen = new Set<string>();
  const bump = (k: string): void => { census[k] = (census[k] ?? 0) + 1; };

  for (let i = 1; i < leads.length; i++) {
    const row = leads[i] ?? [];
    const emailNorm = normalizeEmail(row[2] ?? '');
    if (!isValidEmail(emailNorm)) { bump('invalid_email'); continue; }

    const status = (row[6] ?? '').trim();
    if (!NUDGEABLE_STATUSES.includes(status)) { bump('status_excluded'); continue; }

    // They already signed up for the masterclass this email is advertising. Stop nurturing.
    if (registered.has(emailNorm)) { bump('already_registered'); continue; }

    const key = emailKey(mcId, emailNorm, SEQ_ID);
    if (seen.has(key)) { bump('duplicate_row'); continue; }
    seen.add(key);
    if (logKeys.has(key)) { bump('already_sent'); continue; }

    if (due.length >= maxSends) { bump('deferred'); continue; }
    // Sheets rows are 1-based and row 1 is the header, so the sheet row is the array index plus one.
    due.push({ rowIndex: i + 1, firstName: (row[1] ?? '').trim() || 'there', emailNorm, key });
    bump('due');
  }
  return { due, census };
}

// Branded re-engagement email. This is only the STYLING wrapper — to change the words, edit
// EMAIL_COPY at the top of the file.
function buildNudgeHtml(firstName: string): string {
  const tokens: Record<string, string> = { firstName, link: SIGNUP_PAGE_URL };
  const before = EMAIL_COPY.paragraphs.map((p) => `<p style="margin:0 0 16px;">${fill(p, tokens)}</p>`).join('\n        ');
  const after = EMAIL_COPY.paragraphsAfterCta.map((p) => `<p style="margin:0 0 16px;">${fill(p, tokens)}</p>`).join('\n        ');
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
        <h1 style="font-family:${BRAND.serif};font-weight:600;color:${BRAND.heading};font-size:30px;margin:0 0 6px;">${fill(EMAIL_COPY.heading, tokens)}</h1>
        <p style="margin:0 0 16px;">${fill(EMAIL_COPY.greeting, tokens)}</p>
        ${before}
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${SIGNUP_PAGE_URL}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-family:${BRAND.sans};font-weight:600;font-size:14px;letter-spacing:.5px;text-decoration:none;padding:13px 32px;border-radius:999px;">${fill(EMAIL_COPY.ctaLabel, tokens)}</a>
        </div>
        <p style="margin:0 0 16px;">${fill(EMAIL_COPY.closing, tokens)}</p>
        ${after}
        <p style="font-family:${BRAND.serif};font-style:italic;font-size:22px;color:${BRAND.heading};margin:8px 0 2px;">${fill(EMAIL_COPY.signoff, tokens)}</p>
      </div>
      <div style="padding:22px 34px 28px;border-top:1px solid ${BRAND.hairline};margin-top:18px;">
        <p style="color:${BRAND.footer};font-size:11.5px;line-height:1.6;margin:0;">
          <b style="color:${BRAND.heading};">She's That Girl Co.</b><br>
          <a href="https://shesthatgirl.co" style="color:${BRAND.footer};">shesthatgirl.co</a> &nbsp;·&nbsp; hello@shesthatgirl.co<br>
          You're receiving this because you subscribed to updates from She's That Girl Co.<br>
          <a href="mailto:${UNSUB_MAILTO}?subject=Unsubscribe" style="color:${BRAND.footer};text-decoration:underline;">Unsubscribe</a>
        </p>
      </div>
    </div>
  </div></body></html>`;
}

export class StgcReengagementFlow extends BubbleFlow<'schedule/cron'> {
  // Cron expressions are UTC. Weekly, Tuesdays 11:00 AM CDT. A nudge, not a drip: a cold list resents daily mail,
  // and every send is ledgered, so cadence only decides how often a NEW masterclass is announced.
  readonly cronSchedule = '0 16 * * 2';

  // The payload is unused (this flow takes no inputs) but BubbleLab's validator requires a
  // CronEvent parameter on a schedule/cron trigger.
  async handle(payload: CronEvent): Promise<Output> {
    const nowMs = Date.now();

    const contentRes = await this.fetchContent();
    if (!contentRes.success) {
      return { status: 'blocked', reason: 'content_fetch_failed', message: 'Could not read /api/content. Nothing sent.' };
    }
    const cohort = activeCohortId(parseSettings((contentRes.data?.body ?? '') as string), nowMs);
    if (!cohort.ok) {
      // No usable upcoming masterclass means there is nothing to invite anyone to.
      return { status: 'blocked', reason: cohort.reason, message: 'No usable upcoming masterclass. Nothing sent.' };
    }

    const leadRead = await this.readLeads();
    if (!leadRead.success) {
      return { status: 'blocked', reason: 'leads_read_failed', masterclassId: cohort.id, message: 'Could not read Leads. Nothing sent.' };
    }
    const suRead = await this.readSignups();
    if (!suRead.success) {
      return { status: 'blocked', reason: 'signups_read_failed', masterclassId: cohort.id, message: 'Could not read Signups. Nothing sent.' };
    }
    // Without the ledger every lead looks un-emailed and the whole list would be mailed again.
    const logRead = await this.readEmailLog();
    if (!logRead.success) {
      return { status: 'blocked', reason: 'emaillog_read_failed', masterclassId: cohort.id, message: 'Could not read EmailLog. Nothing sent.' };
    }

    const leadValues = (leadRead.data?.values ?? []) as string[][];
    const registered = registeredEmails((suRead.data?.values ?? []) as string[][], cohort.id);
    const logKeys = buildLogKeySet((logRead.data?.values ?? []) as string[][]);
    const maxSends = TEST_MODE ? TEST_MODE_MAX_SENDS : MAX_SENDS_PER_RUN;
    const plan = buildPlan(leadValues, logKeys, registered, cohort.id, maxSends);

    // The loop lives here because BubbleLab forbids a private method calling another private method.
    const sent: string[] = [];
    let statusUpdated = 0;
    for (const task of plan.due) {
      const recipients = TEST_MODE ? TEST_RECIPIENTS : [task.emailNorm];
      const sendRes = await this.sendNudge(task.firstName, recipients);
      await this.appendEmailLog(cohort.id, task, sendRes.success ? task.key : `${task.key}:failed`);
      if (!sendRes.success) continue;
      sent.push(task.emailNorm);
      // Only advance status after a send actually succeeded, so a failure leaves the lead eligible.
      const statusRes = await this.markNurturing(task.rowIndex, new Date(nowMs).toISOString());
      if (statusRes.success) statusUpdated++;
    }

    return {
      status: 'ok',
      masterclassId: cohort.id,
      sent,
      statusUpdated,
      census: plan.census,
      testMode: TEST_MODE,
    };
  }

  // Fetches the live site content so we know which masterclass is currently being advertised.
  private async fetchContent() {
    const reengageContentFetcher = new HttpBubble({ url: API_CONTENT_URL, method: 'GET', responseType: 'text' });
    return await reengageContentFetcher.action();
  }

  // Reads the Leads tab: the warm audience, including the Beacons import once it exists.
  private async readLeads() {
    const leadsReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Leads' });
    return await leadsReader.action();
  }

  // Reads Signups so anyone already registered for this cohort is excluded from the invite.
  private async readSignups() {
    const reengageSignupsReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Signups' });
    return await reengageSignupsReader.action();
  }

  // Reads the EmailLog ledger, which is what stops a lead being invited to the same masterclass twice.
  private async readEmailLog() {
    const reengageEmailLogReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'EmailLog' });
    return await reengageEmailLogReader.action();
  }

  // Records the outcome. Keyed by cohort so a NEW masterclass is a fresh invite for the same lead,
  // while the same masterclass never invites them twice. A ':failed' key never matches "already
  // sent", so the next weekly run retries.
  private async appendEmailLog(mcId: string, task: NudgeTask, key: string) {
    const reengageLogWriter = new GoogleSheetsBubble({
      operation: 'append_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'EmailLog!A1',
      values: [[`${mcId}:${task.emailNorm}`, task.emailNorm, SEQUENCE_LABEL, key, new Date().toISOString()]],
      value_input_option: 'RAW', insert_data_option: 'INSERT_ROWS',
    });
    return await reengageLogWriter.action();
  }

  // Advances one lead from New to Nurturing and stamps last_nudged. Writes only that row's two cells
  // (Leads columns G and H) rather than rewriting the tab, so a concurrent edit is not clobbered.
  private async markNurturing(rowIndex: number, nowIso: string) {
    const leadStatusWriter = new GoogleSheetsBubble({
      operation: 'update_values', spreadsheet_id: ENGINE_SHEET_ID, range: `Leads!G${rowIndex}:H${rowIndex}`,
      values: [['Nurturing', nowIso]],
      value_input_option: 'RAW',
    });
    return await leadStatusWriter.action();
  }

  // Sends the branded invite. Recipients are the safe test inboxes while TEST_MODE is on.
  private async sendNudge(firstName: string, recipients: string[]) {
    const reengageMailer = new ResendBubble({
      operation: 'send_email', from: FROM_ADDRESS, reply_to: REPLY_TO, to: recipients,
      subject: fill(EMAIL_COPY.subject, { firstName }),
      html: buildNudgeHtml(firstName),
      headers: { 'List-Unsubscribe': `<mailto:${UNSUB_MAILTO}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    return await reengageMailer.action();
  }
}
