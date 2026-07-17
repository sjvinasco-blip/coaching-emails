import {
  BubbleFlow,
  GoogleSheetsBubble,
  type WebhookEvent,
} from '@bubblelab/bubble-core';

// ============================================================================
//  WHY THIS IS A WEBHOOK AND NOT A ZOOM INTEGRATION
//  --------------------------------------------------------------------------
//  Zoom's participant-report API needs a paid plan on the account that HOSTS the meeting. Sophia now
//  has a brand-owned Zoom login and /api/content no longer points at the old LSU institutional URL,
//  so a real Zoom sync may well be possible, but the plan tier has not been confirmed. Rather than
//  write an integration against access nobody has verified, this flow accepts attendance records
//  from whatever source can produce them: a pasted Zoom CSV export, a manual list, or a later
//  automated Zoom pull. Only the INPUT would change; the matching and writing below stay as they are.
// ============================================================================

// ---- Config -------------------------------------------------------------
const ENGINE_SHEET_ID = '1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0';

// This flow sends no email, so there is no TEST_MODE recipient to guard. What it does instead is
// write to the sheet, so DRY_RUN is the equivalent safety switch: true reports exactly what it would
// change without touching a single cell.
const DRY_RUN = true;

// Signups column indices (see HEADERS in setup-and-migrate.ts).
const COL_ATTENDED = 'I';
const COL_STATUS = 'H';

export interface AttendancePayload extends WebhookEvent {
  /**
   * The masterclass this attendance is for, written as its date in YYYY-MM-DD form. This is the
   * cohort id you will see in the masterclass_id column of the Signups tab.
   * @canBeFile false
   */
  masterclassId: string;
  /**
   * Who attended. Paste one email address per line, or upload the attendee CSV that Zoom exports
   * (any line containing an email address works; everything else on the line is ignored).
   * @canBeFile true
   */
  attendees: string;
  /**
   * Set to false to actually write the attendance into the sheet. Leave true to preview what would
   * change without modifying anything.
   * @canBeFile false
   */
  dryRun?: boolean;
}

export interface Output {
  status: string;
  masterclassId?: string;
  /** How many attendee addresses were recognised in the input. */
  attendeesParsed?: number;
  markedAttended?: string[];
  markedNoShow?: string[];
  /** Attendees who were not registered for this cohort. Reported, never invented as new signups. */
  unmatched?: string[];
  dryRun?: boolean;
  message?: string;
}

// ---- Pure helpers (module scope) ----------------------------------------
function normalizeEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

// Pulls every email address out of the pasted text. Written to accept a raw Zoom CSV export as-is
// (where the address is one column among many) as well as a plain one-per-line list, so whoever runs
// this does not have to clean the file up first.
function parseAttendees(raw: string): string[] {
  const found = new Set<string>();
  const matches = (raw || '').match(/[^\s,;"'<>]+@[^\s,;"'<>]+\.[^\s,;"'<>]+/g) ?? [];
  for (const m of matches) {
    const e = normalizeEmail(m);
    if (e.includes('@')) found.add(e);
  }
  return Array.from(found);
}

interface RowUpdate {
  rowIndex: number;
  emailNorm: string;
  attended: boolean;
}

interface Reconciliation {
  updates: RowUpdate[];
  markedAttended: string[];
  markedNoShow: string[];
  unmatched: string[];
}

// Matches the attendee list against the cohort's signups and works out the minimum set of row
// changes. Pure and side-effect free, so what it decides can be checked by reading it.
//
// Two deliberate choices. First, only rows whose value actually CHANGES are updated, which keeps a
// re-run from rewriting the whole cohort and makes repeated imports cheap and safe. Second, an
// attendee who is not in Signups is reported as unmatched rather than added: this flow's job is to
// record attendance, and inventing a registration nobody made would corrupt the funnel numbers.
function reconcile(signups: string[][], mcId: string, attendees: Set<string>): Reconciliation {
  const updates: RowUpdate[] = [];
  const markedAttended: string[] = [];
  const markedNoShow: string[] = [];
  const matched = new Set<string>();

  for (let i = 1; i < signups.length; i++) {
    const row = signups[i] ?? [];
    if ((row[1] ?? '').trim() !== mcId) continue;
    const emailNorm = normalizeEmail(row[3] ?? '');
    if (!emailNorm) continue;

    const didAttend = attendees.has(emailNorm);
    if (didAttend) matched.add(emailNorm);

    const currentAttended = (row[8] ?? '').trim().toLowerCase();
    const desiredAttended = didAttend ? 'yes' : 'no';
    if (currentAttended === desiredAttended) continue;

    // Sheets rows are 1-based and row 1 is the header, so the sheet row is the array index plus one.
    updates.push({ rowIndex: i + 1, emailNorm, attended: didAttend });
    if (didAttend) markedAttended.push(emailNorm);
    else markedNoShow.push(emailNorm);
  }

  const unmatched = Array.from(attendees).filter((e) => !matched.has(e));
  return { updates, markedAttended, markedNoShow, unmatched };
}

export class StgcAttendanceFlow extends BubbleFlow<'webhook/http'> {
  async handle(payload: AttendancePayload): Promise<Output> {
    const { masterclassId = '', attendees = '', dryRun = DRY_RUN } = payload;

    const mcId = masterclassId.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mcId)) {
      return { status: 'error', message: 'masterclassId must be the cohort date in YYYY-MM-DD form.' };
    }

    const attendeeList = parseAttendees(attendees);
    // An empty list would mark every registrant of the cohort a no-show. That is a plausible real
    // outcome but far more likely a bad paste or an empty export, so it stops rather than guessing.
    if (attendeeList.length === 0) {
      return {
        status: 'error', masterclassId: mcId, attendeesParsed: 0,
        message: 'No email addresses found in the attendee list. Nothing changed. If literally nobody attended, mark the no-shows by hand.',
      };
    }

    const suRead = await this.readSignups();
    if (!suRead.success) {
      return { status: 'error', masterclassId: mcId, message: 'Could not read Signups; nothing changed. Retry.' };
    }
    const suValues = (suRead.data?.values ?? []) as string[][];
    const result = reconcile(suValues, mcId, new Set(attendeeList));

    if (result.updates.length === 0) {
      return {
        status: 'ok', masterclassId: mcId, attendeesParsed: attendeeList.length,
        markedAttended: [], markedNoShow: [], unmatched: result.unmatched, dryRun,
        message: 'Attendance already matches the sheet. Nothing to change.',
      };
    }

    if (dryRun) {
      return {
        status: 'preview', masterclassId: mcId, attendeesParsed: attendeeList.length,
        markedAttended: result.markedAttended, markedNoShow: result.markedNoShow,
        unmatched: result.unmatched, dryRun: true,
        message: `Would update ${result.updates.length} rows. Re-run with dryRun set to false to apply.`,
      };
    }

    // The loop lives here because BubbleLab forbids a private method calling another private method.
    // Each row is written individually so a partial failure leaves the rest correct rather than
    // rolling back into an inconsistent tab.
    let applied = 0;
    for (const u of result.updates) {
      const res = await this.markAttendance(u.rowIndex, u.attended);
      if (res.success) applied++;
    }

    return {
      status: applied === result.updates.length ? 'ok' : 'partial',
      masterclassId: mcId,
      attendeesParsed: attendeeList.length,
      markedAttended: result.markedAttended,
      markedNoShow: result.markedNoShow,
      unmatched: result.unmatched,
      dryRun: false,
      message: applied === result.updates.length
        ? `Updated ${applied} rows.`
        : `Updated ${applied} of ${result.updates.length} rows. Re-run to finish the rest; already-correct rows are skipped.`,
    };
  }

  // Reads the Signups tab. Attendance is matched against it by normalized email, and only registered
  // people can be marked, so this is the full universe of rows this flow may touch.
  private async readSignups() {
    const attendanceSignupsReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Signups' });
    return await attendanceSignupsReader.action();
  }

  // Updates one signup's status and attended cells. Targets that row's exact range rather than
  // rewriting the tab, so a re-import cannot clobber unrelated edits, and writes the status column
  // too so Flow 5 can tell an attendee apart from a no-show without re-deriving it.
  private async markAttendance(rowIndex: number, attended: boolean) {
    const attendanceWriter = new GoogleSheetsBubble({
      operation: 'update_values', spreadsheet_id: ENGINE_SHEET_ID,
      range: `Signups!${COL_STATUS}${rowIndex}:${COL_ATTENDED}${rowIndex}`,
      values: [[attended ? 'Attended' : 'No-show', attended ? 'yes' : 'no']],
      value_input_option: 'RAW',
    });
    return await attendanceWriter.action();
  }
}
