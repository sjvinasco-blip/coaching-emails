import {
  BubbleFlow,
  HttpBubble,
  GoogleSheetsBubble,
  ResendBubble,
  type WebhookEvent,
} from '@bubblelab/bubble-core';

// ---- Config -------------------------------------------------------------
const ENGINE_SHEET_ID = '1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0';
const API_CONTENT_URL = 'https://shesthatgirl.co/api/content';

// SAFETY: while TEST_MODE is true, confirmations go ONLY to these inboxes, never a real registrant.
const TEST_MODE = true;
const TEST_RECIPIENTS = ['itismevarnica@gmail.com'];

// Sender identity. Address stays on BubbleLab's system domain until shesthatgirl.co verifies in Resend;
// swap FROM_ADDRESS to "Sophia · She's That Girl Co. <hello@shesthatgirl.co>" after verification.
const FROM_ADDRESS = "She's That Girl Co. <welcome@hello.bubblelab.ai>";
const REPLY_TO = 'hello@shesthatgirl.co';
const UNSUB_MAILTO = 'unsubscribe@shesthatgirl.co';
const DEFAULT_TITLE = "She's That Girl Co. Free Masterclass";

// Identifies this email within the funnel. EmailLog.email_key is built from
// masterclass_id + normalized email + this id, so later flows (reminders, nurture) can ask
// "was this exact email already sent to this exact person for this exact masterclass?".
const SEQ_ID = 'seq1';

// ============================================================================
//  EMAIL COPY  —  Sophia edits ONLY this block to change the confirmation email.
//  --------------------------------------------------------------------------
//  How to change what registrants receive:
//   * Change the words inside the quotes. That's it.
//   * Keep every {curly token} exactly as written — they auto-fill per registrant:
//       {firstName}  {title}  {date}  {time}  {link}
//   * To add or remove a paragraph, add or remove a line in `paragraphs` (keep the
//     quotes and the trailing comma).
//   * Do NOT touch buildConfirmationHtml() below — that is just the styling wrapper.
//  After editing here, re-run the flow once to confirm it still sends.
// ============================================================================
const EMAIL_COPY = {
  subject: "You're in, girl. Here's your link 🤍",
  heading: "You're in, girl. 🤍",
  greeting: 'Hey {firstName}!',
  intro: "You're officially registered for the <b>{title}</b> and I am so excited to see you there.",
  detailsIntro: "Here's everything you need:",
  ctaLabel: 'Join the Masterclass',
  paragraphs: [
    "Screenshot this, set a reminder, do what you gotta do. Just don't miss it.",
    'Financial freedom is possible. A better life IS possible. And it starts with showing up.',
    'See you inside.',
  ],
  signoff: 'Sophia 🤍',
  ps: "P.S. Can't make it live? Just reply and let me know. I got you.",
};

// Replaces {firstName}/{title}/{date}/{time}/{link} tokens inside any copy string above.
function fill(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k) => tokens[k] ?? '');
}

// ---- Brand tokens (from the live site) ----------------------------------
const BRAND = {
  pageBg: '#F5EDE8', cardBg: '#FFFFFF', headerBg: '#FAF5F2',
  monogram: '#D4756A', monogramText: '#FAF7F5', heading: '#7A5555',
  body: '#4A3F3F', accent: '#A85F5F', softBg: '#FAF5F2', softBorder: '#EADDD5',
  hairline: '#EDD5D5', footer: '#B3A5A5',
  serif: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
  sans: "'Jost', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
};

// ---- Types --------------------------------------------------------------
interface McSettings { dateIso: string; timezone: string; link: string; }
interface McInfo { id: string; title: string; displayDate: string; displayTime: string; timezone: string; link: string; }

export interface SignupPayload extends WebhookEvent {
  /** Full name from the masterclass signup form. @canBeFile false */
  name: string;
  /** Email address from the signup form. @canBeFile false */
  email: string;
  /** Instagram/TikTok handle from the form (optional). @canBeFile false */
  handle?: string;
  /** Signup timestamp sent by the site (ISO). Optional — server time is used if absent. @canBeFile false */
  date?: string;
}

// ---- Pure helpers (module scope) ---------------------------------------
function firstNameOf(fullName: string): string {
  const t = (fullName || '').trim();
  return t ? t.split(/\s+/)[0] : 'there';
}

// The one place an email address is canonicalised. Everything that stores, compares, or keys on an
// address goes through this, so " Sophia@Gmail.com " from a paste and "sophia@gmail.com" from the
// form are treated as the same person rather than registering twice and being emailed twice.
function normalizeEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

function isValidEmail(emailNorm: string): boolean {
  return emailNorm.length > 0 && emailNorm.includes('@');
}

// Builds the deterministic EmailLog key. Self-contained by design: the key alone answers
// "already sent?" with one exact string match, without depending on how signup_id was formatted.
function emailKey(mcId: string, emailNorm: string, seqId: string): string {
  return `${mcId}:${emailNorm}:${seqId}`;
}

// True only when a SUCCESSFUL send is on record. Failed sends are logged with a ':failed' suffix,
// so they never match here and the confirmation can still be retried.
function emailKeyExists(values: string[][], key: string): boolean {
  for (let i = 1; i < values.length; i++) { if ((values[i]?.[3] ?? '') === key) return true; }
  return false;
}

// Guards against emailing someone a confirmation we cannot actually honour. A masterclass without a
// resolvable date or a real link would render "TBA" and a dead Join button, so we would rather fail
// the webhook (and let it retry) than deliver a registration the person cannot act on.
function isUsableMasterclass(mc: McInfo): boolean {
  return mc.id !== 'unknown' && mc.link.startsWith('http');
}

// Parses the /api/content body and pulls out the current masterclass settings.
function parseSettings(bodyText: string): McSettings {
  try {
    const parsed = JSON.parse(bodyText) as { stgc_settings?: { date?: string; timezone?: string; link?: string } };
    const s = parsed.stgc_settings ?? {};
    return { dateIso: s.date ?? '', timezone: s.timezone ?? 'CST', link: s.link ?? '' };
  } catch {
    return { dateIso: '', timezone: 'CST', link: '' };
  }
}

// Maps the admin's timezone label to an IANA zone so date/time render in the masterclass's own
// timezone (DST-aware). Defaults to Central if an unknown label comes through.
const TZ_MAP: Record<string, string> = {
  CST: 'America/Chicago', CDT: 'America/Chicago',
  EST: 'America/New_York', EDT: 'America/New_York',
  PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  MST: 'America/Denver', MDT: 'America/Denver',
};
function ianaFor(tz: string): string {
  return TZ_MAP[(tz || '').toUpperCase()] || 'America/Chicago';
}

// Turns raw settings into display-ready masterclass info, rendered in the masterclass's own timezone.
// The masterclass id is the local calendar date so each masterclass is tracked as its own cohort.
function formatMasterclass(s: McSettings): McInfo {
  const tz = ianaFor(s.timezone);
  // Stays 'unknown' unless the date actually parses. Deriving the id from the raw string first
  // would let an unparseable admin entry like "17/07/2026" become a permanent cohort id.
  let id = 'unknown';
  let displayDate = 'TBA';
  let displayTime = 'TBA';
  if (s.dateIso) {
    const d = new Date(s.dateIso);
    if (!isNaN(d.getTime())) {
      id = d.toLocaleDateString('en-CA', { timeZone: tz });
      displayDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
      // timeZoneName renders the zone that is actually in effect on this date, so a July class shows
      // "9:00 PM CDT" rather than the admin's literal "CST" label, which would name an instant an
      // hour off and send anyone who reads it literally to the wrong time.
      displayTime = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' });
    }
  }
  return { id, title: DEFAULT_TITLE, displayDate, displayTime, timezone: s.timezone || 'CST', link: s.link };
}

function masterclassExists(values: string[][], id: string): boolean {
  for (let i = 1; i < values.length; i++) { if ((values[i]?.[0] ?? '') === id) return true; }
  return false;
}

function signupExists(values: string[][], id: string, emailNorm: string): boolean {
  for (let i = 1; i < values.length; i++) {
    const row = values[i] ?? [];
    // Normalises the stored side too, so rows written before addresses were canonicalised still match.
    if ((row[1] ?? '') === id && normalizeEmail(row[3] ?? '') === emailNorm) return true;
  }
  return false;
}

// Branded Seq-1 confirmation. This is only the STYLING wrapper — to change the words,
// edit EMAIL_COPY at the top of the file, not here.
function buildConfirmationHtml(firstName: string, mc: McInfo): string {
  // displayTime already carries the correct zone abbreviation for this date (see formatMasterclass).
  const timeLabel = mc.displayTime;
  const tokens: Record<string, string> = { firstName, title: mc.title, date: mc.displayDate, time: timeLabel, link: mc.link };
  const bodyParagraphs = EMAIL_COPY.paragraphs
    .map((p) => `<p style="margin:0 0 16px;">${fill(p, tokens)}</p>`)
    .join('\n        ');
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
        <p style="margin:0 0 16px;">${fill(EMAIL_COPY.intro, tokens)}</p>
        <p style="margin:0 0 10px;">${fill(EMAIL_COPY.detailsIntro, tokens)}</p>
        <div style="background:${BRAND.softBg};border:1px solid ${BRAND.softBorder};border-radius:14px;padding:20px 22px;margin:6px 0 22px;">
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Date</span> &nbsp;·&nbsp; ${mc.displayDate}</p>
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Time</span> &nbsp;·&nbsp; ${timeLabel}</p>
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Your link</span> &nbsp;·&nbsp; <a href="${mc.link}" style="color:${BRAND.accent};">${mc.link}</a></p>
        </div>
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${mc.link}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-family:${BRAND.sans};font-weight:600;font-size:14px;letter-spacing:.5px;text-decoration:none;padding:13px 32px;border-radius:999px;">${fill(EMAIL_COPY.ctaLabel, tokens)}</a>
        </div>
        ${bodyParagraphs}
        <p style="font-family:${BRAND.serif};font-style:italic;font-size:22px;color:${BRAND.heading};margin:8px 0 2px;">${fill(EMAIL_COPY.signoff, tokens)}</p>
        <p style="color:#8a7d7d;font-size:13px;margin:14px 0 0;">${fill(EMAIL_COPY.ps, tokens)}</p>
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

export interface Output {
  status: string;
  masterclassId?: string;
  /** Where the mail actually went. Under TEST_MODE this is the test inbox, not the registrant. */
  sentTo?: string[];
  /** The real registrant this email was meant for, always shown so TEST_MODE runs stay auditable. */
  intendedTo?: string;
  emailId?: string;
  message?: string;
}

export class StgcSignupFlow extends BubbleFlow<'webhook/http'> {
  async handle(payload: SignupPayload): Promise<Output> {
    const { name, email, handle = '', date } = payload;
    const emailNorm = normalizeEmail(email);
    if (!isValidEmail(emailNorm)) {
      return { status: 'error', message: 'A valid email is required.' };
    }

    // Every read below is checked before use. Previously a failure fell back to an empty default and
    // the flow carried on, which turned an outage into a confirmation email with "TBA" and a dead
    // link. Returning an error instead lets the website's webhook retry once the dependency recovers.
    const contentRes = await this.fetchContent();
    if (!contentRes.success) {
      return { status: 'error', message: 'Could not read the current masterclass; signup not processed. Retry.' };
    }
    const bodyText = (contentRes.data?.body ?? '') as string;
    const mc = formatMasterclass(parseSettings(bodyText));
    if (!isUsableMasterclass(mc)) {
      return { status: 'error', message: 'Masterclass has no usable date or link; signup not processed. Check /admin.' };
    }

    const mcRead = await this.readMasterclasses();
    if (!mcRead.success) {
      return { status: 'error', message: 'Could not read Masterclasses; signup not processed. Retry.' };
    }
    const mcValues = (mcRead.data?.values ?? []) as string[][];
    if (!masterclassExists(mcValues, mc.id)) {
      await this.appendMasterclass(mc);
    }

    // A failed Signups read used to make signupExists() return false, which under a load spike
    // produced a duplicate row AND a second confirmation to someone already registered.
    const suRead = await this.readSignups();
    if (!suRead.success) {
      return { status: 'error', message: 'Could not read Signups; signup not processed. Retry.' };
    }
    const suValues = (suRead.data?.values ?? []) as string[][];
    const alreadySignedUp = signupExists(suValues, mc.id, emailNorm);

    // The signup row and the confirmation are tracked separately. Being in Signups is not proof the
    // confirmation was delivered, so a person who registered but whose email failed must still be
    // able to get it. Only a successful EmailLog key means "this person has their link".
    const logRead = await this.readEmailLog();
    if (!logRead.success) {
      return { status: 'error', message: 'Could not read EmailLog; signup not processed. Retry.' };
    }
    const logValues = (logRead.data?.values ?? []) as string[][];
    const alreadyConfirmed = emailKeyExists(logValues, emailKey(mc.id, emailNorm, SEQ_ID));

    if (alreadySignedUp && alreadyConfirmed) {
      return {
        status: 'duplicate',
        masterclassId: mc.id,
        intendedTo: emailNorm,
        message: 'Already registered and confirmed for this masterclass.',
      };
    }

    const firstName = firstNameOf(name);
    const signedUpAt = date || new Date().toISOString();
    if (!alreadySignedUp) {
      const appendRes = await this.appendSignup(mc.id, firstName, emailNorm, handle, signedUpAt);
      if (!appendRes.success) {
        return { status: 'error', masterclassId: mc.id, message: 'Could not save the signup; not processed. Retry.' };
      }
    }

    const recipients = TEST_MODE ? TEST_RECIPIENTS : [emailNorm];
    const sendRes = await this.sendConfirmation(firstName, mc, recipients);
    await this.appendEmailLog(mc.id, emailNorm, sendRes.success);

    return {
      status: sendRes.success ? 'registered' : 'registered_email_failed',
      masterclassId: mc.id,
      sentTo: recipients,
      intendedTo: emailNorm,
      emailId: sendRes.data?.email_id,
      message: sendRes.success ? undefined : 'Signup saved but the confirmation email failed. Retrying this webhook resends it.',
    };
  }

  // Fetches the live site content (as text) so we can read the current masterclass settings.
  private async fetchContent() {
    const contentFetcher = new HttpBubble({ url: API_CONTENT_URL, method: 'GET', responseType: 'text' });
    return await contentFetcher.action();
  }

  // Reads the Masterclasses tab to check whether this masterclass is already recorded.
  private async readMasterclasses() {
    const masterclassReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Masterclasses' });
    return await masterclassReader.action();
  }

  // Records a newly-seen masterclass (id, title, date, time, timezone, link, status) in the Masterclasses tab.
  private async appendMasterclass(mc: McInfo) {
    const masterclassWriter = new GoogleSheetsBubble({
      operation: 'append_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Masterclasses!A1',
      values: [[mc.id, mc.title, mc.displayDate, mc.displayTime, mc.timezone, mc.link, '', 'upcoming']],
      value_input_option: 'RAW', insert_data_option: 'INSERT_ROWS',
    });
    return await masterclassWriter.action();
  }

  // Reads the Signups tab so we can dedupe this person against this masterclass.
  private async readSignups() {
    const signupsReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Signups' });
    return await signupsReader.action();
  }

  // Reads the EmailLog tab so we can tell "registered" apart from "registered and actually emailed".
  private async readEmailLog() {
    const emailLogReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'EmailLog' });
    return await emailLogReader.action();
  }

  // Appends the new registrant to the Signups tab, keyed by masterclass+email and marked Registered.
  // The email is already normalized by the caller, so signup_id is stable for the same person.
  private async appendSignup(mcId: string, firstName: string, emailNorm: string, handle: string, signedUpAt: string) {
    const signupWriter = new GoogleSheetsBubble({
      operation: 'append_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Signups!A1',
      values: [[`${mcId}:${emailNorm}`, mcId, firstName, emailNorm, handle, signedUpAt, 'website', 'Registered', '']],
      value_input_option: 'RAW', insert_data_option: 'INSERT_ROWS',
    });
    return await signupWriter.action();
  }

  // Records the outcome of the Seq-1 confirmation. email_key carries the full composite identity
  // (masterclass + person + sequence) rather than a bare label, which is what lets this flow and every
  // later one ask "already sent?" with a single exact match. A failure is written with a ':failed'
  // suffix so it can never be mistaken for a delivery, and the next attempt will resend.
  // Column B always holds the real registrant, even under TEST_MODE when the mail went elsewhere.
  private async appendEmailLog(mcId: string, emailNorm: string, ok: boolean) {
    const key = emailKey(mcId, emailNorm, SEQ_ID);
    const emailLogWriter = new GoogleSheetsBubble({
      operation: 'append_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'EmailLog!A1',
      values: [[`${mcId}:${emailNorm}`, emailNorm, SEQ_ID, ok ? key : `${key}:failed`, new Date().toISOString()]],
      value_input_option: 'RAW', insert_data_option: 'INSERT_ROWS',
    });
    return await emailLogWriter.action();
  }

  // Sends the branded confirmation instantly. Recipients are the safe test inboxes while TEST_MODE is on.
  // Subject + body come from EMAIL_COPY at the top of the file.
  private async sendConfirmation(firstName: string, mc: McInfo, recipients: string[]) {
    const timeLabel = mc.displayTime;
    const subjectTokens: Record<string, string> = { firstName, title: mc.title, date: mc.displayDate, time: timeLabel, link: mc.link };
    const confirmationMailer = new ResendBubble({
      operation: 'send_email', from: FROM_ADDRESS, reply_to: REPLY_TO, to: recipients,
      subject: fill(EMAIL_COPY.subject, subjectTokens),
      html: buildConfirmationHtml(firstName, mc),
      headers: { 'List-Unsubscribe': `<mailto:${UNSUB_MAILTO}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    return await confirmationMailer.action();
  }
}
