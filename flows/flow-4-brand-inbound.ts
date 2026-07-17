import {
  BubbleFlow,
  GoogleSheetsBubble,
  ResendBubble,
  type WebhookEvent,
} from '@bubblelab/bubble-core';

// ---- Config -------------------------------------------------------------
const ENGINE_SHEET_ID = '1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0';

// SAFETY: while TEST_MODE is true, the auto-reply goes ONLY to these inboxes, never a real brand.
// Sophia's internal notification is treated the same way, so nothing reaches a real address in test.
const TEST_MODE = true;
const TEST_RECIPIENTS = ['itismevarnica@gmail.com'];

const FROM_ADDRESS = "She's That Girl Co. <welcome@hello.bubblelab.ai>";
const REPLY_TO = 'hello@shesthatgirl.co';
const NOTIFY_ADDRESS = 'hello@shesthatgirl.co';

// ============================================================================
//  LINKS  —  the auto-reply promises these, so a blank one blocks the reply.
//  --------------------------------------------------------------------------
//  An empty booking link does not ship a dead button: the auto-reply is skipped and reported, while
//  the inquiry is still saved and Sophia is still notified. Fill these in to switch the reply on.
// ============================================================================
const BOOKING_LINK = '';
const CASE_STUDIES_LINK = '';

// ============================================================================
//  EMAIL COPY  —  Sophia edits ONLY these blocks.
//  --------------------------------------------------------------------------
//   * Keep every {curly token} exactly as written: {contactName} {brandName}
//   * No em dashes: brand voice rule. stripDashes below enforces it regardless.
// ============================================================================
const AUTO_REPLY_COPY = {
  subject: 'Thanks for reaching out, {brandName}',
  heading: 'Thanks for reaching out. 🤍',
  greeting: 'Hi {contactName},',
  paragraphs: [
    "Thank you for getting in touch about {brandName}. I'm glad you found us.",
    "She's That Girl Co. is a female-centric UGC agency. We build performance-driven content pipelines for brands that want more high-performing assets without taxing their internal team.",
    "The fastest way forward is a quick call. Grab a time that works for you and we'll talk through what you need and whether we're the right fit.",
  ],
  ctaLabel: 'Book a quick call',
  closing: 'Looking forward to it.',
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

// ---- Payload ------------------------------------------------------------
// These field names are NOT a fresh design. They are the contract the website already posts today,
// taken from the live "Brand Inquiry Automation" flow (id 9485) that currently receives these
// webhooks. Renaming any of them breaks the first real inquiry after the webhook is repointed.
export interface BrandInquiryPayload extends WebhookEvent {
  /**
   * Full name of the person reaching out from the brand.
   * @canBeFile false
   */
  contactName: string;
  /**
   * Name of the brand or company getting in touch.
   * @canBeFile false
   */
  brandName: string;
  /**
   * Email address of the brand contact. The auto-reply goes here once TEST_MODE is off.
   * @canBeFile false
   */
  email: string;
  /**
   * The brand's website or social media profile link, if they gave one.
   * @canBeFile false
   */
  website?: string;
  /**
   * What the brand is looking for, in their own words.
   * @canBeFile true
   */
  projectDetails?: string;
  /**
   * Budget range the brand mentioned, if any.
   * @canBeFile false
   */
  budget?: string;
}

export interface Output {
  status: string;
  leadId?: string;
  /** The real brand contact, always shown so TEST_MODE runs stay auditable. */
  intendedTo?: string;
  autoReplySent?: boolean;
  notifySent?: boolean;
  message?: string;
}

// ---- Pure helpers (module scope) ----------------------------------------
function normalizeEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

function isValidEmail(emailNorm: string): boolean {
  return emailNorm.length > 0 && emailNorm.includes('@');
}

// Same guarantee as the outbound flow (flows/outreach-enrich-draft.ts): no message ever ships with
// an em dash, whatever a human typed into the copy above.
function stripDashes(input: string): string {
  return (input || '')
    .replace(/\s*[—–―]\s*/g, ', ')
    .replace(/,\s*,/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,(?=\S)/g, ', ')
    .trim();
}

// Brand-supplied text lands in an HTML email and in Sophia's inbox, so it is escaped before it is
// rendered. Nothing here is trusted: the payload comes straight off a public web form.
function escapeHtml(raw: string): string {
  return (raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fill(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k) => tokens[k] ?? '');
}

// One inquiry per brand contact. The website has no idempotency key of its own, so a double submit
// or a webhook retry would otherwise create a second row and a second auto-reply.
function leadExists(values: string[][], leadId: string): boolean {
  for (let i = 1; i < values.length; i++) { if ((values[i]?.[0] ?? '') === leadId) return true; }
  return false;
}

// Branded auto-reply. This is only the STYLING wrapper — to change the words, edit AUTO_REPLY_COPY.
function buildAutoReplyHtml(contactName: string, brandName: string): string {
  const tokens: Record<string, string> = { contactName: escapeHtml(contactName), brandName: escapeHtml(brandName) };
  const bodyParagraphs = AUTO_REPLY_COPY.paragraphs
    .map((p) => `<p style="margin:0 0 16px;">${stripDashes(fill(p, tokens))}</p>`)
    .join('\n        ');
  const caseStudies = CASE_STUDIES_LINK
    ? `<p style="margin:0 0 16px;">You can see what we've done for other brands here: <a href="${CASE_STUDIES_LINK}" style="color:${BRAND.accent};">our case studies</a>.</p>`
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
        <h1 style="font-family:${BRAND.serif};font-weight:600;color:${BRAND.heading};font-size:30px;margin:0 0 6px;">${stripDashes(fill(AUTO_REPLY_COPY.heading, tokens))}</h1>
        <p style="margin:0 0 16px;">${stripDashes(fill(AUTO_REPLY_COPY.greeting, tokens))}</p>
        ${bodyParagraphs}
        ${caseStudies}
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${BOOKING_LINK}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-family:${BRAND.sans};font-weight:600;font-size:14px;letter-spacing:.5px;text-decoration:none;padding:13px 32px;border-radius:999px;">${stripDashes(AUTO_REPLY_COPY.ctaLabel)}</a>
        </div>
        <p style="margin:0 0 16px;">${stripDashes(fill(AUTO_REPLY_COPY.closing, tokens))}</p>
        <p style="font-family:${BRAND.serif};font-style:italic;font-size:22px;color:${BRAND.heading};margin:8px 0 2px;">${AUTO_REPLY_COPY.signoff}</p>
      </div>
      <div style="padding:22px 34px 28px;border-top:1px solid ${BRAND.hairline};margin-top:18px;">
        <p style="color:${BRAND.footer};font-size:11.5px;line-height:1.6;margin:0;">
          <b style="color:${BRAND.heading};">She's That Girl Co.</b><br>
          <a href="https://shesthatgirl.co" style="color:${BRAND.footer};">shesthatgirl.co</a> &nbsp;·&nbsp; hello@shesthatgirl.co<br>
          You're receiving this because you contacted us through our website.
        </p>
      </div>
    </div>
  </div></body></html>`;
}

// Sophia's internal notification. Every field the website sends is shown, including website and
// budget, which the BrandLeads schema has no column for (see the note in handle()).
function buildNotifyHtml(p: { contactName: string; brandName: string; emailNorm: string; website: string; projectDetails: string; budget: string; submittedAt: string }): string {
  const rows = [
    `<b>Brand:</b> ${escapeHtml(p.brandName)}`,
    `<b>Contact:</b> ${escapeHtml(p.contactName)}`,
    `<b>Email:</b> ${escapeHtml(p.emailNorm)}`,
    p.website ? `<b>Website:</b> ${escapeHtml(p.website)}` : '',
    p.budget ? `<b>Budget:</b> ${escapeHtml(p.budget)}` : '',
    p.projectDetails ? `<b>Project:</b> ${escapeHtml(p.projectDetails)}` : '',
    `<b>Received:</b> ${escapeHtml(p.submittedAt)}`,
  ].filter(Boolean).join('<br>');
  return `<h3>New brand inquiry</h3><p>${rows}</p><p>Saved to the BrandLeads tab of the STGC Masterclass Engine sheet.</p>`;
}

export class StgcBrandInboundFlow extends BubbleFlow<'webhook/http'> {
  async handle(payload: BrandInquiryPayload): Promise<Output> {
    const {
      contactName = '',
      brandName = '',
      email = '',
      website = '',
      projectDetails = '',
      budget = '',
    } = payload;

    const emailNorm = normalizeEmail(email);
    if (!isValidEmail(emailNorm)) {
      return { status: 'error', message: 'A valid email is required.' };
    }
    if (!brandName.trim() && !contactName.trim()) {
      return { status: 'error', intendedTo: emailNorm, message: 'A brand name or contact name is required.' };
    }

    // A failed read would make leadExists() return false and produce a duplicate row plus a second
    // auto-reply to a brand, so it stops rather than degrading to an empty tab.
    const leadRead = await this.readBrandLeads();
    if (!leadRead.success) {
      return { status: 'error', intendedTo: emailNorm, message: 'Could not read BrandLeads; inquiry not processed. Retry.' };
    }
    const leadValues = (leadRead.data?.values ?? []) as string[][];
    const leadId = emailNorm;
    if (leadExists(leadValues, leadId)) {
      return { status: 'duplicate', leadId, intendedTo: emailNorm, message: 'This brand contact has already been recorded.' };
    }

    // BrandLeads columns are [lead_id, brand_name, contact_name, email, message, submitted_at,
    // status]. The website also sends `website` and `budget`, which have no column here. Rather than
    // drop them, they are folded into the message field so nothing the brand told us is lost. If
    // Sophia would rather have them as real columns, that is a schema decision, not a code one.
    const submittedAt = new Date().toISOString();
    const messageParts = [projectDetails.trim(), website.trim() ? `Website: ${website.trim()}` : '', budget.trim() ? `Budget: ${budget.trim()}` : ''];
    const message = messageParts.filter((s) => s.length > 0).join(' | ');

    const appendRes = await this.appendBrandLead(leadId, brandName.trim(), contactName.trim(), emailNorm, message, submittedAt);
    if (!appendRes.success) {
      return { status: 'error', intendedTo: emailNorm, message: 'Could not save the inquiry; not processed. Retry.' };
    }

    // The auto-reply promises a booking link. With no link configured there is nothing to promise,
    // so it is skipped rather than sent with a dead button. The inquiry is still saved and Sophia is
    // still notified, which is the part that must never be lost.
    let autoReplySent = false;
    if (BOOKING_LINK) {
      const replyRecipients = TEST_MODE ? TEST_RECIPIENTS : [emailNorm];
      const replyRes = await this.sendAutoReply(contactName.trim() || 'there', brandName.trim() || 'your brand', replyRecipients);
      autoReplySent = replyRes.success;
    }

    const notifyRecipients = TEST_MODE ? TEST_RECIPIENTS : [NOTIFY_ADDRESS];
    const notifyRes = await this.notifySophia(notifyRecipients, {
      contactName: contactName.trim(), brandName: brandName.trim(), emailNorm,
      website: website.trim(), projectDetails: projectDetails.trim(), budget: budget.trim(), submittedAt,
    });

    return {
      status: 'recorded',
      leadId,
      intendedTo: emailNorm,
      autoReplySent,
      notifySent: notifyRes.success,
      message: BOOKING_LINK ? undefined : 'Inquiry saved and Sophia notified, but no auto-reply was sent because BOOKING_LINK is not set.',
    };
  }

  // Reads the BrandLeads tab so a repeated webhook cannot create a second lead or a second reply.
  private async readBrandLeads() {
    const brandLeadsReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'BrandLeads' });
    return await brandLeadsReader.action();
  }

  // Records the inquiry in the BrandLeads tab, keyed by the normalized contact email and marked New
  // so it enters the same status progression the other lead tabs use.
  private async appendBrandLead(leadId: string, brandName: string, contactName: string, emailNorm: string, message: string, submittedAt: string) {
    const brandLeadWriter = new GoogleSheetsBubble({
      operation: 'append_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'BrandLeads!A1',
      values: [[leadId, brandName, contactName, emailNorm, message, submittedAt, 'New']],
      value_input_option: 'RAW', insert_data_option: 'INSERT_ROWS',
    });
    return await brandLeadWriter.action();
  }

  // Sends the branded auto-reply with the booking link. Recipients are the safe test inboxes while
  // TEST_MODE is on. Subject and body come from AUTO_REPLY_COPY at the top of the file.
  private async sendAutoReply(contactName: string, brandName: string, recipients: string[]) {
    const brandAutoReplyMailer = new ResendBubble({
      operation: 'send_email', from: FROM_ADDRESS, reply_to: REPLY_TO, to: recipients,
      subject: stripDashes(fill(AUTO_REPLY_COPY.subject, { contactName, brandName })),
      html: buildAutoReplyHtml(contactName, brandName),
    });
    return await brandAutoReplyMailer.action();
  }

  // Tells Sophia a brand is waiting. Routed to the test inbox under TEST_MODE too, so a test run
  // cannot put fake inquiries in her real inbox.
  private async notifySophia(recipients: string[], p: { contactName: string; brandName: string; emailNorm: string; website: string; projectDetails: string; budget: string; submittedAt: string }) {
    const brandNotifyMailer = new ResendBubble({
      operation: 'send_email', from: FROM_ADDRESS, reply_to: REPLY_TO, to: recipients,
      subject: `[STGC] New brand inquiry: ${p.brandName || p.contactName}`,
      html: buildNotifyHtml(p),
    });
    return await brandNotifyMailer.action();
  }
}
