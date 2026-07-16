import {
  BubbleFlow,
  AIAgentBubble,
  GoogleSheetsBubble,
  ResendBubble,
  CompanyEnrichmentTool,
  type WebhookEvent,
} from '@bubblelab/bubble-core';

export interface OutreachPayload extends WebhookEvent {
  /**
   * Your scraped company list, ONE company per line. Each line can be a company name,
   * a domain like acme.com, or a LinkedIn company URL. Paste in bulk or upload a file.
   * @canBeFile true
   */
  companies: string;
  /**
   * The STGC sales SOP / playbook that guides how every message is written: voice, the offer,
   * what STGC provides, and how to frame the call. Paste the full SOP text or upload it.
   * @canBeFile true
   */
  sop: string;
  /**
   * Google Sheet where results are written. Defaults to the STGC Outreach Engine sheet.
   * @canBeGoogleFile true
   * @canBeFile false
   */
  spreadsheetId?: string;
  /**
   * Team email address(es) that get the reminder digest whenever new LinkedIn-only contacts are
   * added, so they know to go send those DMs by hand. Separate multiple addresses with commas.
   * @canBeFile false
   */
  teamEmails?: string;
  /**
   * Sender identity for the cold emails once your Resend domain is verified, written as
   * Name plus address in angle brackets. Leave blank while testing to use Bubble Lab's default sender.
   * @canBeFile false
   */
  fromEmail?: string;
  /**
   * Address where prospect replies should land (your Outlook inbox). Used as reply-to on every email.
   * @canBeFile false
   */
  replyToEmail?: string;
  /**
   * Your call booking link (Calendly or similar) offered in every email and DM as the call to action.
   * @canBeFile false
   */
  calendarLink?: string;
  /**
   * Display name signed at the bottom of every message.
   * @canBeFile false
   */
  senderName?: string;
  /**
   * How many top contacts (CXOs and decision makers first) to pull per company.
   * @canBeFile false
   */
  contactsPerCompany?: number;
  /**
   * Safety switch. TRUE (default) writes everything into the sheet as drafts and sends NO cold
   * emails, so you can review first. FALSE actually sends the emails via Resend. The team LinkedIn
   * reminder email always sends regardless of this switch.
   * @canBeFile false
   */
  dryRun?: boolean;
}

export interface OutreachOutput {
  success: boolean;
  companiesProcessed: number;
  contactsFound: number;
  emailDrafts: number;
  linkedinContacts: number;
  emailsSent: number;
  spreadsheetUrl: string;
  notes: string;
}

interface EnrichedContact {
  name?: string;
  title?: string;
  role?: string;
  headline?: string;
  linkedinUrl?: string;
  emails?: string[];
  location?: string;
  summary?: string;
}

interface CompanyInfo {
  name?: string;
  website?: string;
  industry?: string;
  description?: string;
  headcount?: number;
  hqCity?: string;
  hqCountry?: string;
}

interface Outreach {
  subject?: string;
  body?: string;
}

// Strips every em dash and en dash out of AI copy and replaces the surrounding gap with a comma,
// then tidies up any doubled or misplaced commas so the sentence still reads cleanly. This is the
// hard guarantee that no message ever ships with an em dash even if the model slips one in.
function stripDashes(input: string): string {
  return (input || '')
    .replace(/\s*[—–―]\s*/g, ', ')
    .replace(/,\s*,/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,(?=\S)/g, ', ')
    .trim();
}

// Splits the pasted company blob into a clean list. Users paste one company per line (name, domain,
// or LinkedIn URL); semicolons are also treated as separators. Blank lines are dropped.
function parseCompanies(raw: string): string[] {
  return (raw || '')
    .split(/[\n;]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

// Parses the AI writer's JSON output into a subject and body, tolerating stray code fences. If the
// model returns plain text instead of JSON, the whole thing becomes the body so nothing is lost.
function parseOutreach(raw: string): Outreach {
  const cleaned = (raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const obj = JSON.parse(cleaned) as Outreach;
    return { subject: obj.subject ?? '', body: obj.body ?? '' };
  } catch {
    return { subject: '', body: cleaned };
  }
}

// Turns the enriched company record into a compact briefing the writer uses to name what the
// company does before pitching, so the email is grounded in real detail rather than generic praise.
function companyToText(c: CompanyInfo, fallbackName: string): string {
  const parts: string[] = [];
  parts.push('Name: ' + (c.name ?? fallbackName));
  if (c.industry) parts.push('Industry: ' + c.industry);
  if (c.description) parts.push('What they do: ' + c.description);
  if (c.headcount) parts.push('Headcount: ' + c.headcount);
  const loc = [c.hqCity, c.hqCountry].filter(Boolean).join(', ');
  if (loc) parts.push('HQ: ' + loc);
  return parts.join('\n');
}

// Turns one contact into a compact briefing so the writer can tie the pitch to this exact person's
// role and likely priorities instead of addressing the company in the abstract.
function contactToText(p: EnrichedContact): string {
  const parts: string[] = [];
  if (p.name) parts.push('Name: ' + p.name);
  if (p.title) parts.push('Title: ' + p.title);
  if (p.headline) parts.push('Headline: ' + p.headline);
  if (p.summary) parts.push('Summary: ' + p.summary);
  if (p.location) parts.push('Location: ' + p.location);
  return parts.join('\n');
}

export class STGCOutreachFlow extends BubbleFlow<'webhook/http'> {
  async handle(payload: OutreachPayload): Promise<OutreachOutput> {
    const {
      companies = '',
      sop = '',
      spreadsheetId = '1k75yBdQz5YaZB_I8x2PA0_NFXn14ikHDIRcp2B4Pjj4',
      teamEmails = '',
      fromEmail = '',
      replyToEmail = '',
      calendarLink = '',
      senderName = 'Sophia',
      contactsPerCompany = 5,
      dryRun = true,
    } = payload;

    const spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit';
    const companyList = parseCompanies(companies);

    if (companyList.length === 0) {
      return { success: false, companiesProcessed: 0, contactsFound: 0, emailDrafts: 0, linkedinContacts: 0, emailsSent: 0, spreadsheetUrl, notes: 'No companies provided. Paste one company per line (name, domain, or LinkedIn URL).' };
    }
    if (!sop || sop.trim().length < 20) {
      return { success: false, companiesProcessed: 0, contactsFound: 0, emailDrafts: 0, linkedinContacts: 0, emailsSent: 0, spreadsheetUrl, notes: 'SOP missing or too short. Paste the STGC SOP so every message can be written from it.' };
    }

    const today = new Date().toISOString().slice(0, 10);
    const enrichedRows: (string | number)[][] = [];
    const draftRows: (string | number)[][] = [];
    const linkedinRows: (string | number)[][] = [];
    const sentRows: (string | number)[][] = [];
    let contactsFound = 0;
    let emailsSent = 0;

    for (const company of companyList) {
      const enrich = await this.enrichCompany(company, contactsPerCompany);
      if (!enrich.success || !enrich.data) continue;
      const info = (enrich.data.company ?? {}) as CompanyInfo;
      const companyName = info.name ?? company;
      const whatTheyDo = info.description ?? info.industry ?? '';
      const hq = [info.hqCity, info.hqCountry].filter(Boolean).join(', ');
      const companyText = companyToText(info, company);
      const contacts = (enrich.data.contacts ?? []) as unknown as EnrichedContact[];

      for (const person of contacts) {
        contactsFound++;
        const email = person.emails && person.emails.length > 0 ? String(person.emails[0]) : '';
        const channel = email ? 'email' : 'linkedin';

        const ai = await this.writeOutreach(sop, senderName, calendarLink, channel, companyText, contactToText(person));
        const parsed = parseOutreach(ai.success ? ai.data.response : '');
        const subject = stripDashes(parsed.subject || 'Quick idea for ' + companyName);
        const body = stripDashes(parsed.body || '');

        enrichedRows.push([today, companyName, whatTheyDo, info.industry ?? '', info.headcount ?? '', hq, person.name ?? '', person.title ?? '', person.role ?? '', person.linkedinUrl ?? '', email, person.location ?? '', channel === 'email' ? 'Email' : 'LinkedIn']);

        if (channel === 'email') {
          draftRows.push([today, companyName, person.name ?? '', person.title ?? '', email, subject, body, dryRun ? 'Draft' : 'Sent', dryRun ? '' : today]);
        } else {
          linkedinRows.push([today, companyName, person.name ?? '', person.title ?? '', person.linkedinUrl ?? '', body, 'To Send', '', '']);
        }
      }
    }

    if (enrichedRows.length > 0) await this.appendToTab(spreadsheetId, 'Enriched', enrichedRows);
    if (draftRows.length > 0) await this.appendToTab(spreadsheetId, 'EmailDrafts', draftRows);
    if (linkedinRows.length > 0) await this.appendToTab(spreadsheetId, 'LinkedIn Manual', linkedinRows);

    if (!dryRun && draftRows.length > 0) {
      for (const row of draftRows) {
        const to = String(row[4]);
        const subj = String(row[5]);
        const bod = String(row[6]);
        const sendRes = await this.sendOutreachEmail(fromEmail, replyToEmail, to, subj, bod);
        if (sendRes.success) emailsSent++;
        sentRows.push([today, 'Email', String(row[1]), String(row[2]), to, subj, sendRes.success ? 'Sent ' + (sendRes.data.email_id ?? '') : 'Failed: ' + (sendRes.error ?? '')]);
      }
      if (sentRows.length > 0) await this.appendToTab(spreadsheetId, 'SentLog', sentRows);
    }

    if (linkedinRows.length > 0 && teamEmails.trim().length > 0) {
      await this.notifyTeam(teamEmails, linkedinRows, spreadsheetUrl);
    }

    return {
      success: true,
      companiesProcessed: companyList.length,
      contactsFound,
      emailDrafts: draftRows.length,
      linkedinContacts: linkedinRows.length,
      emailsSent,
      spreadsheetUrl,
      notes: dryRun
        ? 'Draft mode: every email is written into the EmailDrafts tab but nothing was sent. Review the copy, then run again with dryRun set to false to send.'
        : 'Live mode: emails were sent via Resend and logged in the SentLog tab.',
    };
  }

  // Enriches a single company through Crustdata via the CompanyEnrichmentTool. The provider is pinned
  // to crustdata because that is the path that actually returns decision makers, CXOs, and founders
  // (FullEnrich returns company metadata only). companyIdentifier accepts a name, domain, or LinkedIn
  // URL and auto-detects the type; limit controls how many prioritized contacts come back per company.
  // The result carries both the company profile (description, industry, headcount, HQ) and the contact
  // list (name, title, role, linkedinUrl, emails) that the rest of the flow writes to the sheet.
  private async enrichCompany(companyIdentifier: string, limit: number) {
    const companyEnricher = new CompanyEnrichmentTool({
      companyIdentifier,
      provider: 'crustdata',
      limit,
    });
    return await companyEnricher.action();
  }

  // Writes one personalized outreach message straight from the STGC SOP, which is injected as the
  // source of truth for voice and offer. The systemPrompt hard-bans em and en dashes and forces the
  // model to frame the message as this company's need connected to what STGC provides, ending on a
  // single call to book a call. jsonMode returns clean {subject, body} JSON. Swap the model to a
  // faster one (for example google/gemini-3-flash-preview) for cheaper runs, or raise temperature
  // for more variety. The channel argument switches between a full email and a shorter LinkedIn DM.
  private async writeOutreach(sop: string, senderName: string, calendarLink: string, channel: string, companyText: string, contactText: string) {
    const ctaLine = calendarLink
      ? 'Call to action: invite them to book a quick call here: ' + calendarLink
      : 'Call to action: invite them to reply to set up a quick call.';
    const channelRules =
      channel === 'email'
        ? 'Write a short cold EMAIL of roughly 90 to 130 words with a specific, low-hype subject line. Put the subject in "subject" and the email in "body".'
        : 'Write a short LinkedIn DM of roughly 50 to 90 words. No subject is needed, so set "subject" to an empty string and put the DM in "body".';
    const writer = new AIAgentBubble({
      name: 'STGC Outreach Writer',
      systemPrompt:
        'You are the outbound sales writer for She\'s That Girl Co (STGC). You write warm, sharp, human outreach that books calls. Follow the provided SOP exactly for voice, offer, and framing. HARD RULES: (1) NEVER use em dashes or en dashes anywhere. Use commas, periods, or plain hyphens only. (2) No corporate filler and no "I hope this email finds you well". (3) Personalize to what THIS company does and THIS person\'s role: name their likely need in one line, then connect it to what STGC provides according to the SOP. (4) Exactly one clear call to action to book a call. (5) Sign off as ' +
        senderName +
        '. Return ONLY valid JSON in exactly this shape: {"subject": "string", "body": "string"}.',
      message:
        'SOP (the source of truth for voice, offer, and what STGC provides):\n"""\n' +
        sop +
        '\n"""\n\nCHANNEL INSTRUCTIONS: ' +
        channelRules +
        '\n' +
        ctaLine +
        '\n\nCOMPANY:\n' +
        companyText +
        '\n\nCONTACT:\n' +
        contactText +
        '\n\nWrite the message now as JSON only.',
      model: { model: 'anthropic/claude-sonnet-4-6', temperature: 0.7, maxTokens: 1200, jsonMode: true },
    });
    return await writer.action();
  }

  // Appends a batch of rows to one tab of the outreach sheet. Called separately for the Enriched,
  // EmailDrafts, LinkedIn Manual, and SentLog tabs. The A:Z range lets Google auto-detect the end of
  // the existing table so new rows always land underneath the headers; USER_ENTERED keeps dates and
  // numbers formatted naturally rather than as raw strings.
  private async appendToTab(spreadsheetId: string, tab: string, values: (string | number)[][]) {
    const appender = new GoogleSheetsBubble({
      operation: 'append_values',
      spreadsheet_id: spreadsheetId,
      range: tab + '!A:Z',
      values,
      value_input_option: 'USER_ENTERED',
    });
    return await appender.action();
  }

  // Sends one finished cold email through Resend. The from address is only set when the user has
  // provided a verified sender (otherwise Bubble Lab's default sender is used so testing works out of
  // the box), and reply_to routes every prospect reply back to the user's own inbox (their Outlook).
  private async sendOutreachEmail(fromEmail: string, replyToEmail: string, to: string, subject: string, body: string) {
    const mailer = new ResendBubble({
      operation: 'send_email',
      ...(fromEmail ? { from: fromEmail } : {}),
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
      to: [to],
      subject,
      text: body,
    });
    return await mailer.action();
  }

  // Emails the team a digest listing every new LinkedIn-only contact plus a link to the sheet, so they
  // can open the LinkedIn Manual tab and paste each ready-to-send message. This send intentionally uses
  // Bubble Lab's default sender (no from override) so the reminder always goes out even before the
  // custom outreach domain is verified.
  private async notifyTeam(teamEmails: string, linkedinRows: (string | number)[][], spreadsheetUrl: string) {
    const to = teamEmails.split(',').map((e) => e.trim()).filter((e) => e.length > 0);
    const lines = linkedinRows
      .map((r, i) => i + 1 + '. ' + String(r[2]) + ' (' + String(r[3]) + ') at ' + String(r[1]) + (r[4] ? ' - ' + String(r[4]) : ''))
      .join('\n');
    const body =
      'New LinkedIn contacts to message by hand (' +
      linkedinRows.length +
      '):\n\n' +
      lines +
      '\n\nOpen the "LinkedIn Manual" tab for the exact ready-to-send message for each person:\n' +
      spreadsheetUrl +
      '\n\nEach row has the message written and ready to paste.';
    const notifier = new ResendBubble({
      operation: 'send_email',
      to,
      subject: '[STGC Outreach] ' + linkedinRows.length + ' LinkedIn messages to send',
      text: body,
    });
    return await notifier.action();
  }
}
