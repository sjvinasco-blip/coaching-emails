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
const TEST_RECIPIENTS = ['ugcvarnica@gmail.com', 'itismevarnica@gmail.com'];

// Sender identity. Address stays on BubbleLab's system domain until shesthatgirl.co verifies in Resend;
// swap FROM_ADDRESS to "Sophia · She's That Girl Co. <hello@shesthatgirl.co>" after verification.
const FROM_ADDRESS = "She's That Girl Co. <welcome@hello.bubblelab.ai>";
const REPLY_TO = 'hello@shesthatgirl.co';
const UNSUB_MAILTO = 'unsubscribe@shesthatgirl.co';
const DEFAULT_TITLE = "She's That Girl Co. Free Masterclass";

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
  let id = s.dateIso ? s.dateIso.slice(0, 10) : 'unknown';
  let displayDate = 'TBA';
  let displayTime = 'TBA';
  if (s.dateIso) {
    const d = new Date(s.dateIso);
    if (!isNaN(d.getTime())) {
      id = d.toLocaleDateString('en-CA', { timeZone: tz });
      displayDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
      displayTime = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    }
  }
  return { id, title: DEFAULT_TITLE, displayDate, displayTime, timezone: s.timezone || 'CST', link: s.link };
}

function masterclassExists(values: string[][], id: string): boolean {
  for (let i = 1; i < values.length; i++) { if ((values[i]?.[0] ?? '') === id) return true; }
  return false;
}

function signupExists(values: string[][], id: string, email: string): boolean {
  const target = email.toLowerCase();
  for (let i = 1; i < values.length; i++) {
    const row = values[i] ?? [];
    if ((row[1] ?? '') === id && (row[3] ?? '').toLowerCase() === target) return true;
  }
  return false;
}

// Branded Seq-1 confirmation. Edit the copy here to change what registrants receive.
function buildConfirmationHtml(firstName: string, mc: McInfo): string {
  const timeLabel = `${mc.displayTime} ${mc.timezone}`;
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
        <h1 style="font-family:${BRAND.serif};font-weight:600;color:${BRAND.heading};font-size:30px;margin:0 0 6px;">You're in, girl. 🤍</h1>
        <p style="margin:0 0 16px;">Hey ${firstName}!</p>
        <p style="margin:0 0 16px;">You're officially registered for the <b>${mc.title}</b> and I am so excited to see you there.</p>
        <p style="margin:0 0 10px;">Here's everything you need:</p>
        <div style="background:${BRAND.softBg};border:1px solid ${BRAND.softBorder};border-radius:14px;padding:20px 22px;margin:6px 0 22px;">
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Date</span> &nbsp;·&nbsp; ${mc.displayDate}</p>
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Time</span> &nbsp;·&nbsp; ${timeLabel}</p>
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Your link</span> &nbsp;·&nbsp; <a href="${mc.link}" style="color:${BRAND.accent};">${mc.link}</a></p>
        </div>
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${mc.link}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-family:${BRAND.sans};font-weight:600;font-size:14px;letter-spacing:.5px;text-decoration:none;padding:13px 32px;border-radius:999px;">Join the Masterclass</a>
        </div>
        <p style="margin:0 0 16px;">Screenshot this, set a reminder, do what you gotta do. Just don't miss it.</p>
        <p style="margin:0 0 16px;">Financial freedom is possible. A better life IS possible. And it starts with showing up.</p>
        <p style="margin:0 0 4px;">See you inside.</p>
        <p style="font-family:${BRAND.serif};font-style:italic;font-size:22px;color:${BRAND.heading};margin:8px 0 2px;">Sophia 🤍</p>
        <p style="color:#8a7d7d;font-size:13px;margin:14px 0 0;">P.S. Can't make it live? Just reply and let me know. I got you.</p>
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
  sentTo?: string[];
  emailId?: string;
  message?: string;
}

export class StgcSignupFlow extends BubbleFlow<'webhook/http'> {
  async handle(payload: SignupPayload): Promise<Output> {
    const { name, email, handle = '', date } = payload;
    if (!email || !email.includes('@')) {
      return { status: 'error', message: 'A valid email is required.' };
    }

    const contentRes = await this.fetchContent();
    const bodyText = (contentRes.data?.body ?? '') as string;
    const mc = formatMasterclass(parseSettings(bodyText));

    const mcRead = await this.readMasterclasses();
    const mcValues = (mcRead.data?.values ?? []) as string[][];
    if (!masterclassExists(mcValues, mc.id)) {
      await this.appendMasterclass(mc);
    }

    const suRead = await this.readSignups();
    const suValues = (suRead.data?.values ?? []) as string[][];
    if (signupExists(suValues, mc.id, email)) {
      return { status: 'duplicate', masterclassId: mc.id, message: 'Already registered for this masterclass.' };
    }

    const firstName = firstNameOf(name);
    const signedUpAt = date || new Date().toISOString();
    await this.appendSignup(mc.id, firstName, email, handle, signedUpAt);

    const recipients = TEST_MODE ? TEST_RECIPIENTS : [email];
    const sendRes = await this.sendConfirmation(firstName, mc, recipients);
    await this.appendEmailLog(mc.id, email, sendRes.success);

    return {
      status: 'registered',
      masterclassId: mc.id,
      sentTo: recipients,
      emailId: sendRes.data?.email_id,
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

  // Appends the new registrant to the Signups tab, keyed by masterclass+email and marked Registered.
  private async appendSignup(mcId: string, firstName: string, email: string, handle: string, signedUpAt: string) {
    const signupWriter = new GoogleSheetsBubble({
      operation: 'append_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Signups!A1',
      values: [[`${mcId}:${email}`, mcId, firstName, email, handle, signedUpAt, 'website', 'Registered', '']],
      value_input_option: 'RAW', insert_data_option: 'INSERT_ROWS',
    });
    return await signupWriter.action();
  }

  // Logs that the Seq-1 confirmation was sent, for idempotency and the analytics dashboard.
  private async appendEmailLog(mcId: string, email: string, ok: boolean) {
    const emailLogWriter = new GoogleSheetsBubble({
      operation: 'append_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'EmailLog!A1',
      values: [[`${mcId}:${email}`, email, 'seq1', ok ? 'confirmation' : 'confirmation_failed', new Date().toISOString()]],
      value_input_option: 'RAW', insert_data_option: 'INSERT_ROWS',
    });
    return await emailLogWriter.action();
  }

  // Sends the branded confirmation instantly. Recipients are the safe test inboxes while TEST_MODE is on.
  private async sendConfirmation(firstName: string, mc: McInfo, recipients: string[]) {
    const confirmationMailer = new ResendBubble({
      operation: 'send_email', from: FROM_ADDRESS, reply_to: REPLY_TO, to: recipients,
      subject: "You're in, girl. Here's your link 🤍",
      html: buildConfirmationHtml(firstName, mc),
      headers: { 'List-Unsubscribe': `<mailto:${UNSUB_MAILTO}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    return await confirmationMailer.action();
  }
}
