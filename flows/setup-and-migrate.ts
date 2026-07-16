import {
  BubbleFlow,
  GoogleSheetsBubble,
  type WebhookEvent,
} from '@bubblelab/bubble-core';

// The old "sophia masterclass" sheet holding the 122 historical signups (Date | Name | Email | Handle).
const OLD_SPREADSHEET_ID = '1wdoyswt8eHgZMmzsPh3faXRdf5Ymc4Bi6VIO8efI420';

// Header rows for each tab of the new engine — these are the column labels Sophia will see.
const HEADERS = {
  Masterclasses: ['masterclass_id', 'title', 'date', 'time_cst', 'timezone', 'zoom_link', 'calendar_link', 'status'],
  Signups: ['signup_id', 'masterclass_id', 'first_name', 'email', 'handle', 'signed_up_at', 'source', 'status', 'attended'],
  EmailLog: ['signup_id', 'email', 'sequence', 'email_key', 'sent_at'],
  Leads: ['lead_id', 'first_name', 'email', 'source', 'first_seen', 'last_engaged', 'status', 'last_nudged'],
  BrandLeads: ['lead_id', 'brand_name', 'contact_name', 'email', 'message', 'submitted_at', 'status'],
};

// Extracts the first name from a full-name string (defensive against blanks/extra spaces).
function firstNameOf(fullName: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
}

// Maps the old [date, name, email, handle] rows into the new Signups schema, skipping any header/blank rows.
function buildSignupRows(oldValues: string[][]): string[][] {
  const rows: string[][] = [];
  let counter = 0;
  for (const r of oldValues) {
    const date = (r[0] ?? '').toString();
    const name = (r[1] ?? '').toString();
    const email = (r[2] ?? '').toString();
    const handle = (r[3] ?? '').toString();
    if (!email.includes('@')) continue;
    counter += 1;
    rows.push([
      'legacy-' + counter,
      'legacy-import',
      firstNameOf(name),
      email,
      handle,
      date,
      'legacy-import',
      'Legacy',
      '',
    ]);
  }
  return rows;
}

export interface Output {
  spreadsheetId: string;
  spreadsheetUrl: string;
  migrated: number;
  message: string;
}

export class StgcEngineSetup extends BubbleFlow<'webhook/http'> {
  async handle(payload: WebhookEvent): Promise<Output> {
    const created = await this.createSpreadsheet();
    if (!created.success) {
      return { spreadsheetId: '', spreadsheetUrl: '', migrated: 0, message: 'Create failed: ' + created.error };
    }
    const spreadsheetId = created.data?.spreadsheet?.spreadsheetId ?? '';
    const spreadsheetUrl = created.data?.spreadsheet?.spreadsheetUrl ?? '';

    await this.writeHeaders(spreadsheetId);

    const old = await this.readOldSheet();
    const oldValues = (old.data?.values ?? []) as string[][];
    const signupRows = buildSignupRows(oldValues);

    let migrated = 0;
    if (signupRows.length > 0) {
      const appendResult = await this.appendSignups(spreadsheetId, signupRows);
      migrated = appendResult.success ? signupRows.length : 0;
    }

    return {
      spreadsheetId,
      spreadsheetUrl,
      migrated,
      message: 'STGC Masterclass Engine created with 5 tabs. Migrated ' + migrated + ' legacy signups.',
    };
  }

  // Creates the STGC Masterclass Engine spreadsheet, provisioning all five tabs in a single call.
  private async createSpreadsheet() {
    const engineCreator = new GoogleSheetsBubble({
      operation: 'create_spreadsheet',
      title: 'STGC Masterclass Engine',
      sheet_titles: ['Masterclasses', 'Signups', 'EmailLog', 'Leads', 'BrandLeads'],
    });
    return await engineCreator.action();
  }

  // Writes the labeled header row into each of the five tabs so every column is clearly named.
  private async writeHeaders(spreadsheetId: string) {
    const hdrMasterclasses = new GoogleSheetsBubble({
      operation: 'update_values',
      spreadsheet_id: spreadsheetId,
      range: 'Masterclasses!A1',
      values: [HEADERS.Masterclasses],
      value_input_option: 'RAW',
    });
    await hdrMasterclasses.action();

    const hdrSignups = new GoogleSheetsBubble({
      operation: 'update_values',
      spreadsheet_id: spreadsheetId,
      range: 'Signups!A1',
      values: [HEADERS.Signups],
      value_input_option: 'RAW',
    });
    await hdrSignups.action();

    const hdrEmailLog = new GoogleSheetsBubble({
      operation: 'update_values',
      spreadsheet_id: spreadsheetId,
      range: 'EmailLog!A1',
      values: [HEADERS.EmailLog],
      value_input_option: 'RAW',
    });
    await hdrEmailLog.action();

    const hdrLeads = new GoogleSheetsBubble({
      operation: 'update_values',
      spreadsheet_id: spreadsheetId,
      range: 'Leads!A1',
      values: [HEADERS.Leads],
      value_input_option: 'RAW',
    });
    await hdrLeads.action();

    const hdrBrandLeads = new GoogleSheetsBubble({
      operation: 'update_values',
      spreadsheet_id: spreadsheetId,
      range: 'BrandLeads!A1',
      values: [HEADERS.BrandLeads],
      value_input_option: 'RAW',
    });
    return await hdrBrandLeads.action();
  }

  // Reads the legacy signups from the old sheet, trying the default first tab 'Sheet1' and
  // falling back to a 'Submissions' tab, returning whichever actually contains the rows.
  private async readOldSheet() {
    const readSheet1 = new GoogleSheetsBubble({
      operation: 'read_values',
      spreadsheet_id: OLD_SPREADSHEET_ID,
      range: 'Sheet1',
    });
    const sheet1Result = await readSheet1.action();
    if (sheet1Result.success && (sheet1Result.data?.values?.length ?? 0) > 0) {
      return sheet1Result;
    }

    const readSubmissions = new GoogleSheetsBubble({
      operation: 'read_values',
      spreadsheet_id: OLD_SPREADSHEET_ID,
      range: 'Submissions',
    });
    return await readSubmissions.action();
  }

  // Appends all migrated legacy signup rows into the Signups tab of the new engine in one batch.
  private async appendSignups(spreadsheetId: string, rows: string[][]) {
    const signupsAppender = new GoogleSheetsBubble({
      operation: 'append_values',
      spreadsheet_id: spreadsheetId,
      range: 'Signups!A1',
      values: rows,
      value_input_option: 'RAW',
      insert_data_option: 'INSERT_ROWS',
    });
    return await signupsAppender.action();
  }
}
