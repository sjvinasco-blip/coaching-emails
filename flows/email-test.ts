import {
  BubbleFlow,
  ResendBubble,
  type WebhookEvent,
} from '@bubblelab/bubble-core';

// SAFETY: while TEST_MODE is true, every email in every STGC flow goes ONLY to TEST_EMAIL,
// never to a real registrant. We flip TEST_MODE to false only when going live.
const TEST_MODE = true;
const TEST_EMAIL = 'ugcvarnica@gmail.com';

// Sender + brand constants. Until the shesthatgirl.co domain is verified in Resend, the email
// address must stay on BubbleLab's system domain; we keep Sophia's name on it and route replies
// to her real inbox. Once the domain verifies we flip FROM to "Sophia <hello@shesthatgirl.co>".
const FROM_ADDRESS = "She's That Girl Co. <welcome@hello.bubblelab.ai>";
const REPLY_TO = 'hello@shesthatgirl.co';
const UNSUB_MAILTO = 'unsubscribe@shesthatgirl.co';

// Brand palette + type — pulled from the live site (terracotta rose on cream, Cormorant + Jost).
const BRAND = {
  pageBg: '#F5EDE8',
  cardBg: '#FFFFFF',
  headerBg: '#FAF5F2',
  monogram: '#D4756A',
  monogramText: '#FAF7F5',
  heading: '#7A5555',
  body: '#4A3F3F',
  accent: '#A85F5F',
  softBg: '#FAF5F2',
  softBorder: '#EADDD5',
  hairline: '#EDD5D5',
  footer: '#B3A5A5',
  serif: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
  sans: "'Jost', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
};

// Builds the fully branded confirmation email: monogram logo header, styled detail card,
// rounded CTA button, Sophia sign-off, and a compliant footer with an unsubscribe link.
function buildConfirmationHtml(firstName: string, mcDate: string, mcTime: string, mcLink: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
  </head>
  <body style="margin:0;padding:0;background:${BRAND.pageBg};">
  <div style="background:${BRAND.pageBg};padding:28px 16px;font-family:${BRAND.sans};">
    <div style="max-width:560px;margin:0 auto;background:${BRAND.cardBg};border:1px solid ${BRAND.hairline};border-radius:18px;overflow:hidden;">

      <!-- Header / logo lockup -->
      <div style="background:${BRAND.headerBg};text-align:center;padding:30px 24px 22px;border-bottom:1px solid ${BRAND.hairline};">
        <div style="width:54px;height:54px;line-height:54px;border-radius:15px;background:${BRAND.monogram};color:${BRAND.monogramText};font-family:${BRAND.serif};font-style:italic;font-weight:600;font-size:34px;display:inline-block;text-align:center;">S</div>
        <div style="margin-top:12px;font-family:${BRAND.sans};font-size:12px;letter-spacing:3px;color:${BRAND.heading};font-weight:600;">SHE'S THAT GIRL CO.</div>
      </div>

      <!-- Body -->
      <div style="padding:34px 34px 12px;color:${BRAND.body};font-size:15px;line-height:1.65;">
        <h1 style="font-family:${BRAND.serif};font-weight:600;color:${BRAND.heading};font-size:30px;margin:0 0 6px;">You're in, girl. 🤍</h1>
        <p style="margin:0 0 16px;">Hey ${firstName}!</p>
        <p style="margin:0 0 16px;">You're officially registered for the <b>She's That Girl Co. Free Masterclass</b> and I am so excited to see you there.</p>
        <p style="margin:0 0 10px;">Here's everything you need:</p>

        <div style="background:${BRAND.softBg};border:1px solid ${BRAND.softBorder};border-radius:14px;padding:20px 22px;margin:6px 0 22px;">
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Date</span> &nbsp;·&nbsp; ${mcDate}</p>
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Time</span> &nbsp;·&nbsp; ${mcTime} CST</p>
          <p style="margin:3px 0;"><span style="color:${BRAND.accent};font-weight:600;">Your link</span> &nbsp;·&nbsp; <a href="${mcLink}" style="color:${BRAND.accent};">${mcLink}</a></p>
        </div>

        <div style="text-align:center;margin:0 0 24px;">
          <a href="${mcLink}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-family:${BRAND.sans};font-weight:600;font-size:14px;letter-spacing:.5px;text-decoration:none;padding:13px 32px;border-radius:999px;">Add to Calendar</a>
        </div>

        <p style="margin:0 0 16px;">Screenshot this, set a reminder, do what you gotta do. Just don't miss it.</p>
        <p style="margin:0 0 16px;">Financial freedom is possible. A better life IS possible. And it starts with showing up.</p>
        <p style="margin:0 0 4px;">See you inside.</p>
        <p style="font-family:${BRAND.serif};font-style:italic;font-size:22px;color:${BRAND.heading};margin:8px 0 2px;">Sophia 🤍</p>
        <p style="color:#8a7d7d;font-size:13px;margin:14px 0 0;">P.S. Can't make it live? Just reply and let me know. I got you.</p>
      </div>

      <!-- Footer -->
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
  success: boolean;
  sentTo: string;
  emailId?: string;
  error?: string;
}

export class StgcEmailTest extends BubbleFlow<'webhook/http'> {
  async handle(payload: WebhookEvent): Promise<Output> {
    const result = await this.sendTestConfirmation();
    return {
      success: result.success,
      sentTo: TEST_EMAIL,
      emailId: result.data?.email_id,
      error: result.success ? undefined : result.error,
    };
  }

  // Sends the branded sample confirmation to the single hardwired TEST_EMAIL. The
  // List-Unsubscribe + List-Unsubscribe-Post headers make Gmail show its native unsubscribe
  // button; a matching footer link covers clients that don't render the header control.
  private async sendTestConfirmation() {
    const recipient = TEST_MODE ? TEST_EMAIL : TEST_EMAIL;
    const html = buildConfirmationHtml('Varnica', 'Thursday, July 10', '6:00 PM', 'https://learn.shesthatgirl.co/live');
    const confirmationMailer = new ResendBubble({
      operation: 'send_email',
      from: FROM_ADDRESS,
      reply_to: REPLY_TO,
      to: [recipient],
      subject: "You're in, girl. Here's your link 🤍",
      html: html,
      headers: {
        'List-Unsubscribe': `<mailto:${UNSUB_MAILTO}?subject=Unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    return await confirmationMailer.action();
  }
}
