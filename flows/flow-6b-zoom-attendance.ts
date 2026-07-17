import {
  BubbleFlow,
  HttpBubble,
  GoogleSheetsBubble,
  type WebhookEvent,
} from '@bubblelab/bubble-core';

// ============================================================================
//  Flow 6b — pull attendance straight from Zoom (the automated half of Flow 6)
//  --------------------------------------------------------------------------
//  Flow 6 (flow-6-attendance.ts) takes a pasted attendee list. This flow fetches the same list from
//  Zoom's Report API so nobody has to export a CSV. Both end in the identical reconcile-and-write
//  step, so switching from paste to API changes only where the emails come from.
//
//  Auth: a Zoom Server-to-Server OAuth app. Its client_id:client_secret is stored as a
//  CUSTOM_AUTH_KEY credential and sent as HTTP Basic on the token call; the account_id below is not
//  secret. The app needs the granular scope `report:read:list_meeting_participants:admin` (+ the
//  meeting-read scopes to resolve occurrences). Requires a paid Zoom plan (Pro+).
//
//  The masterclass runs on a RECURRING meeting (type 3), so attendance is per-occurrence: this flow
//  lists the meeting's ended instances, picks the one whose local date matches the cohort, and pulls
//  that occurrence's participants. The base meeting id alone returns nothing for a recurring meeting.
// ============================================================================

const ENGINE_SHEET_ID = '1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0';

// The Zoom account these masterclasses are hosted on (svinasco@shesthatgirl.co). Not a secret.
const ZOOM_ACCOUNT_ID = 'LqhPROKCT8WQEZ_ALBfrWA';
// The Creator Masterclass meeting, from the /api/content join link zoom.us/j/91498122584.
const DEFAULT_MEETING_ID = '91498122584';

// Writing safety switch, mirroring Flow 6: true previews the row changes without touching a cell.
const DRY_RUN = true;

const COL_ATTENDED = 'I';
const COL_STATUS = 'H';

const TZ_MAP: Record<string, string> = {
  CST: 'America/Chicago', CDT: 'America/Chicago',
  EST: 'America/New_York', EDT: 'America/New_York',
  PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  MST: 'America/Denver', MDT: 'America/Denver',
};

export interface ZoomAttendancePayload extends WebhookEvent {
  /**
   * The masterclass to reconcile, written as its date in YYYY-MM-DD form. This is the cohort id in
   * the masterclass_id column of the Signups tab, and it is matched against Zoom's ended sessions.
   * @canBeFile false
   */
  masterclassId: string;
  /**
   * Zoom meeting id. Defaults to the Creator Masterclass room. Only change this if the class moved
   * to a different meeting. The numeric id from a zoom.us/j/NNNN link.
   * @canBeFile false
   */
  meetingId?: string;
  /**
   * Optional. A specific Zoom occurrence UUID to use instead of auto-matching by date. Handy when
   * two sessions fall on the same local day, or to force a particular past instance.
   * @canBeFile false
   */
  occurrenceUuid?: string;
  /**
   * Set to false to write the attendance into the sheet. Leave true to preview what would change.
   * @canBeFile false
   */
  dryRun?: boolean;
}

export interface Output {
  status: string;
  masterclassId?: string;
  occurrenceUuid?: string;
  occurrenceStart?: string;
  attendeesFetched?: number;
  matchedWithEmail?: number;
  markedAttended?: string[];
  markedNoShow?: string[];
  /** Zoom attendees with no email on record, which cannot be matched to a signup. */
  attendeesWithoutEmail?: number;
  dryRun?: boolean;
  message?: string;
}

interface Instance { uuid: string; start_time: string; }
interface Participant { user_email?: string; name?: string; }
interface RowUpdate { rowIndex: number; emailNorm: string; attended: boolean; }

// ---- Pure helpers (module scope) ----------------------------------------
function normalizeEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

function parseJson(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; }
  }
  return (body ?? {}) as Record<string, unknown>;
}

// A meeting UUID that contains '/' or begins with '//' must be double URL-encoded before it goes in
// a Zoom API path, per Zoom's own rule. UUIDs without those characters are used as-is.
function encodeUuid(uuid: string): string {
  if (uuid.startsWith('/') || uuid.includes('//')) {
    return encodeURIComponent(encodeURIComponent(uuid));
  }
  return encodeURIComponent(uuid);
}

// Picks the ended occurrence whose start time, in the cohort's own timezone, lands on the cohort
// date. Matching in local time is what keeps a late-evening class from being attributed to the next
// UTC day. Returns the newest match if several share the date.
function pickOccurrence(instances: Instance[], cohortId: string, iana: string): Instance | null {
  let best: Instance | null = null;
  for (const inst of instances) {
    if (!inst.start_time) continue;
    const localDate = new Date(inst.start_time).toLocaleDateString('en-CA', { timeZone: iana });
    if (localDate !== cohortId) continue;
    if (!best || inst.start_time > best.start_time) best = inst;
  }
  return best;
}

function timezoneForCohort(mcValues: string[][], cohortId: string): string {
  for (let i = 1; i < mcValues.length; i++) {
    const row = mcValues[i] ?? [];
    if ((row[0] ?? '').trim() === cohortId) return TZ_MAP[(row[4] ?? '').trim().toUpperCase()] ?? 'America/Chicago';
  }
  return 'America/Chicago';
}

// Same contract as Flow 6's reconcile(): only rows whose attended value actually changes are
// updated, and an attendee who never registered is reported, never invented as a signup.
function reconcile(signups: string[][], cohortId: string, attended: Set<string>): { updates: RowUpdate[]; markedAttended: string[]; markedNoShow: string[] } {
  const updates: RowUpdate[] = [];
  const markedAttended: string[] = [];
  const markedNoShow: string[] = [];
  for (let i = 1; i < signups.length; i++) {
    const row = signups[i] ?? [];
    if ((row[1] ?? '').trim() !== cohortId) continue;
    const emailNorm = normalizeEmail(row[3] ?? '');
    if (!emailNorm) continue;
    const didAttend = attended.has(emailNorm);
    const current = (row[8] ?? '').trim().toLowerCase();
    const desired = didAttend ? 'yes' : 'no';
    if (current === desired) continue;
    updates.push({ rowIndex: i + 1, emailNorm, attended: didAttend });
    if (didAttend) markedAttended.push(emailNorm); else markedNoShow.push(emailNorm);
  }
  return { updates, markedAttended, markedNoShow };
}

export class StgcZoomAttendanceFlow extends BubbleFlow<'webhook/http'> {
  async handle(payload: ZoomAttendancePayload): Promise<Output> {
    const { masterclassId = '', meetingId = DEFAULT_MEETING_ID, occurrenceUuid = '', dryRun = DRY_RUN } = payload;
    const cohortId = masterclassId.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cohortId)) {
      return { status: 'error', message: 'masterclassId must be the cohort date in YYYY-MM-DD form.' };
    }

    const tokenRes = await this.getToken();
    const tokenBody = parseJson(tokenRes.data?.body);
    const accessToken = (tokenBody.access_token as string) ?? '';
    if (!tokenRes.success || !accessToken) {
      return { status: 'error', masterclassId: cohortId, message: 'Zoom auth failed: ' + JSON.stringify(tokenBody).slice(0, 200) };
    }

    // Resolve which Zoom session to read. An explicit UUID wins; otherwise match by cohort date.
    let uuid = occurrenceUuid;
    let occStart = '';
    if (!uuid) {
      const mcRead = await this.readMasterclasses();
      const iana = timezoneForCohort((mcRead.data?.values ?? []) as string[][], cohortId);
      const instRes = await this.listInstances(meetingId, accessToken);
      const instBody = parseJson(instRes.data?.body);
      const instances = ((instBody.meetings as Instance[]) ?? []);
      const occ = pickOccurrence(instances, cohortId, iana);
      if (!occ) {
        return {
          status: 'no_occurrence', masterclassId: cohortId, attendeesFetched: 0,
          message: `Zoom has ${instances.length} ended session(s) for this meeting, none on ${cohortId}. If the class just ended, Zoom's report can lag a few minutes.`,
        };
      }
      uuid = occ.uuid;
      occStart = occ.start_time;
    }

    // Pull every participant page for the occurrence. The loop lives here because a private method
    // cannot call another private method.
    const emails = new Set<string>();
    let fetched = 0;
    let withoutEmail = 0;
    let nextPageToken = '';
    for (let page = 0; page < 50; page++) {
      const partRes = await this.getParticipantsPage(uuid, accessToken, nextPageToken);
      if (!partRes.success) {
        return { status: 'error', masterclassId: cohortId, occurrenceUuid: uuid, message: 'Zoom participants call failed: ' + String(partRes.error ?? '').slice(0, 200) };
      }
      const body = parseJson(partRes.data?.body);
      const participants = (body.participants as Participant[]) ?? [];
      for (const p of participants) {
        fetched++;
        const e = normalizeEmail(p.user_email ?? '');
        if (e) emails.add(e); else withoutEmail++;
      }
      nextPageToken = (body.next_page_token as string) ?? '';
      if (!nextPageToken) break;
    }

    const suRead = await this.readSignups();
    if (!suRead.success) {
      return { status: 'error', masterclassId: cohortId, occurrenceUuid: uuid, message: 'Could not read Signups; nothing changed. Retry.' };
    }
    const result = reconcile((suRead.data?.values ?? []) as string[][], cohortId, emails);

    if (result.updates.length === 0) {
      return {
        status: 'ok', masterclassId: cohortId, occurrenceUuid: uuid, occurrenceStart: occStart,
        attendeesFetched: fetched, matchedWithEmail: emails.size, attendeesWithoutEmail: withoutEmail,
        markedAttended: [], markedNoShow: [], dryRun,
        message: 'Attendance already matches the sheet. Nothing to change.',
      };
    }

    if (dryRun) {
      return {
        status: 'preview', masterclassId: cohortId, occurrenceUuid: uuid, occurrenceStart: occStart,
        attendeesFetched: fetched, matchedWithEmail: emails.size, attendeesWithoutEmail: withoutEmail,
        markedAttended: result.markedAttended, markedNoShow: result.markedNoShow, dryRun: true,
        message: `Would update ${result.updates.length} rows. Re-run with dryRun set to false to apply.`,
      };
    }

    let applied = 0;
    for (const u of result.updates) {
      const res = await this.markAttendance(u.rowIndex, u.attended);
      if (res.success) applied++;
    }
    return {
      status: applied === result.updates.length ? 'ok' : 'partial',
      masterclassId: cohortId, occurrenceUuid: uuid, occurrenceStart: occStart,
      attendeesFetched: fetched, matchedWithEmail: emails.size, attendeesWithoutEmail: withoutEmail,
      markedAttended: result.markedAttended, markedNoShow: result.markedNoShow, dryRun: false,
      message: `Updated ${applied} of ${result.updates.length} rows.`,
    };
  }

  // Exchanges the stored Server-to-Server client credentials (CUSTOM_AUTH_KEY, sent as HTTP Basic)
  // for a 1-hour access token. grant_type and account_id go in the form body, which is the shape
  // Zoom's token endpoint accepts.
  private async getToken() {
    const zoomTokenExchanger = new HttpBubble({
      url: 'https://zoom.us/oauth/token',
      method: 'POST', authType: 'basic', responseType: 'text',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=account_credentials&account_id=' + ZOOM_ACCOUNT_ID,
    });
    return await zoomTokenExchanger.action();
  }

  // Reads the Masterclasses tab only to learn the cohort's timezone, so a Zoom session start (UTC)
  // is matched to the right local calendar day.
  private async readMasterclasses() {
    const zoomMcReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Masterclasses' });
    return await zoomMcReader.action();
  }

  // Lists the ended occurrences of the recurring meeting. Each carries a uuid + start_time used to
  // find the one matching the cohort date.
  private async listInstances(meetingId: string, token: string) {
    const zoomInstanceReader = new HttpBubble({
      url: 'https://api.zoom.us/v2/past_meetings/' + meetingId + '/instances',
      method: 'GET', responseType: 'text',
      headers: { Authorization: 'Bearer ' + token },
    });
    return await zoomInstanceReader.action();
  }

  // Fetches one page of a session's participant report. The UUID is encoded per Zoom's slash rule.
  private async getParticipantsPage(uuid: string, token: string, nextPageToken: string) {
    const pageParam = nextPageToken ? '&next_page_token=' + encodeURIComponent(nextPageToken) : '';
    const zoomParticipantsReader = new HttpBubble({
      url: 'https://api.zoom.us/v2/report/meetings/' + encodeUuid(uuid) + '/participants?page_size=300' + pageParam,
      method: 'GET', responseType: 'text',
      headers: { Authorization: 'Bearer ' + token },
    });
    return await zoomParticipantsReader.action();
  }

  // Reads Signups; attendance is matched against it by normalized email.
  private async readSignups() {
    const zoomSignupsReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Signups' });
    return await zoomSignupsReader.action();
  }

  // Writes one signup's status + attended cells, targeting that row's exact range so a re-run never
  // rewrites the tab or clobbers an unrelated edit.
  private async markAttendance(rowIndex: number, attended: boolean) {
    const zoomAttendanceWriter = new GoogleSheetsBubble({
      operation: 'update_values', spreadsheet_id: ENGINE_SHEET_ID,
      range: `Signups!${COL_STATUS}${rowIndex}:${COL_ATTENDED}${rowIndex}`,
      values: [[attended ? 'Attended' : 'No-show', attended ? 'yes' : 'no']],
      value_input_option: 'RAW',
    });
    return await zoomAttendanceWriter.action();
  }
}
