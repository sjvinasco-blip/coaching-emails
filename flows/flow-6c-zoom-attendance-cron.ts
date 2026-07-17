import {
  BubbleFlow,
  HttpBubble,
  GoogleSheetsBubble,
  type CronEvent,
} from '@bubblelab/bubble-core';

// ============================================================================
//  Flow 6c — automatic attendance sync (cron)
//  --------------------------------------------------------------------------
//  The hands-off version of Flow 6b. On a schedule it asks Zoom which sessions of the masterclass
//  room have ended recently, pulls each one's participants, and marks Attended / No-show in Signups.
//  Nobody has to trigger it or paste a CSV.
//
//  Why a poll and not a Zoom "meeting.ended" webhook: the webhook needs a URL-validation
//  handshake (HMAC of Zoom's challenge token) and per-request signature checks, which the flow
//  runtime may not be able to compute. Polling needs none of that, survives a missed event, and an
//  hourly lag is fine for attendance that feeds a day-0 nurture email. Flow 6b stays for manual
//  backfill of a specific session.
//
//  Auth + meeting shape are identical to Flow 6b: Server-to-Server OAuth (base64 client creds in a
//  CUSTOM_AUTH_KEY), recurring meeting, attendance read per ended occurrence.
// ============================================================================

const ENGINE_SHEET_ID = '1Qq19urGgtU3JuYvTbHd7o_3cjE7lvpOwQk9313AqNk0';
const ZOOM_ACCOUNT_ID = 'LqhPROKCT8WQEZ_ALBfrWA';
const DEFAULT_MEETING_ID = '91498122584';

// Writing safety switch, mirroring Flow 6/6b: true previews without touching a cell.
const DRY_RUN = true;

// Only occurrences that ended within this many days are reconciled each run. Bounds the Zoom calls
// and the work; reconcile is a no-op on rows that already match, so overlap between runs is safe.
const LOOKBACK_DAYS = 3;

const COL_ATTENDED = 'I';
const COL_STATUS = 'H';

const TZ_MAP: Record<string, string> = {
  CST: 'America/Chicago', CDT: 'America/Chicago',
  EST: 'America/New_York', EDT: 'America/New_York',
  PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  MST: 'America/Denver', MDT: 'America/Denver',
};
// STGC masterclasses run on Central. Used to derive a cohort date from a session's UTC start before
// the sheet's per-cohort timezone (if any) refines it.
const DEFAULT_IANA = 'America/Chicago';

export interface Output {
  status: string;
  occurrencesConsidered?: number;
  occurrencesSynced?: string[];
  totalAttendeesFetched?: number;
  rowsChanged?: number;
  markedAttended?: string[];
  markedNoShow?: string[];
  dryRun?: boolean;
  message?: string;
}

interface Instance { uuid: string; start_time: string; }
interface Participant { user_email?: string }
interface RowUpdate { rowIndex: number; attended: boolean }

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

function encodeUuid(uuid: string): string {
  if (uuid.startsWith('/') || uuid.includes('//')) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}

function timezoneForCohort(mcValues: string[][], cohortId: string): string {
  for (let i = 1; i < mcValues.length; i++) {
    const row = mcValues[i] ?? [];
    if ((row[0] ?? '').trim() === cohortId) return TZ_MAP[(row[4] ?? '').trim().toUpperCase()] ?? DEFAULT_IANA;
  }
  return DEFAULT_IANA;
}

// The cohort a session belongs to is its start converted to the masterclass's local calendar date.
function cohortDateFor(startIso: string, iana: string): string {
  return new Date(startIso).toLocaleDateString('en-CA', { timeZone: iana });
}

// Reconcile identical to Flow 6/6b: only rows whose attended value changes are returned, and a
// non-registrant is never invented as a signup.
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
    updates.push({ rowIndex: i + 1, attended: didAttend });
    if (didAttend) markedAttended.push(emailNorm); else markedNoShow.push(emailNorm);
  }
  return { updates, markedAttended, markedNoShow };
}

function recentInstances(instances: Instance[], nowMs: number): Instance[] {
  const cutoff = nowMs - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return instances.filter((i) => i.start_time && Date.parse(i.start_time) >= cutoff);
}

export class StgcZoomAttendanceCron extends BubbleFlow<'schedule/cron'> {
  // Hourly (UTC). Attendance only appears after a class ends and Zoom's report settles, so a modest
  // lag is fine; the lookback window makes a missed run harmless.
  readonly cronSchedule = '0 * * * *';

  // Payload unused, but the validator requires a CronEvent parameter on a schedule/cron trigger.
  async handle(payload: CronEvent): Promise<Output> {
    const nowMs = Date.now();

    const tokenRes = await this.getToken();
    const accessToken = (parseJson(tokenRes.data?.body).access_token as string) ?? '';
    if (!tokenRes.success || !accessToken) {
      return { status: 'blocked', message: 'Zoom auth failed. No attendance synced.' };
    }

    const instRes = await this.listInstances(DEFAULT_MEETING_ID, accessToken);
    const instances = ((parseJson(instRes.data?.body).meetings as Instance[]) ?? []);
    const recent = recentInstances(instances, nowMs);
    if (recent.length === 0) {
      return { status: 'ok', occurrencesConsidered: 0, occurrencesSynced: [], rowsChanged: 0, dryRun: DRY_RUN, message: `No masterclass sessions ended in the last ${LOOKBACK_DAYS} days.` };
    }

    const mcRead = await this.readMasterclasses();
    const mcValues = (mcRead.data?.values ?? []) as string[][];
    const suRead = await this.readSignups();
    if (!suRead.success) {
      return { status: 'blocked', message: 'Could not read Signups. No attendance synced.' };
    }
    const suValues = (suRead.data?.values ?? []) as string[][];

    // Gather participants per occurrence, reconcile, and collect the row changes. The loops live in
    // handle() because a private method cannot call another private method.
    const synced: string[] = [];
    const allUpdates: RowUpdate[] = [];
    const markedAttended: string[] = [];
    const markedNoShow: string[] = [];
    let totalFetched = 0;

    for (const occ of recent) {
      const iana = timezoneForCohort(mcValues, cohortDateFor(occ.start_time, DEFAULT_IANA));
      const cohortId = cohortDateFor(occ.start_time, iana);

      const emails = new Set<string>();
      let nextPageToken = '';
      let pageOk = true;
      for (let page = 0; page < 50; page++) {
        const partRes = await this.getParticipantsPage(occ.uuid, accessToken, nextPageToken);
        if (!partRes.success) { pageOk = false; break; }
        const body = parseJson(partRes.data?.body);
        for (const p of ((body.participants as Participant[]) ?? [])) {
          totalFetched++;
          const e = normalizeEmail(p.user_email ?? '');
          if (e) emails.add(e);
        }
        nextPageToken = (body.next_page_token as string) ?? '';
        if (!nextPageToken) break;
      }
      if (!pageOk) continue;

      const r = reconcile(suValues, cohortId, emails);
      if (r.updates.length > 0) {
        allUpdates.push(...r.updates);
        markedAttended.push(...r.markedAttended);
        markedNoShow.push(...r.markedNoShow);
        synced.push(`${cohortId} (${r.updates.length})`);
      }
    }

    if (DRY_RUN || allUpdates.length === 0) {
      return {
        status: allUpdates.length === 0 ? 'ok' : 'preview',
        occurrencesConsidered: recent.length, occurrencesSynced: synced,
        totalAttendeesFetched: totalFetched, rowsChanged: allUpdates.length,
        markedAttended, markedNoShow, dryRun: DRY_RUN,
        message: allUpdates.length === 0 ? 'Attendance already matches the sheet.' : `Would update ${allUpdates.length} rows. Set DRY_RUN=false to apply.`,
      };
    }

    let applied = 0;
    for (const u of allUpdates) {
      const res = await this.markAttendance(u.rowIndex, u.attended);
      if (res.success) applied++;
    }
    return {
      status: applied === allUpdates.length ? 'ok' : 'partial',
      occurrencesConsidered: recent.length, occurrencesSynced: synced,
      totalAttendeesFetched: totalFetched, rowsChanged: applied,
      markedAttended, markedNoShow, dryRun: false,
      message: `Updated ${applied} of ${allUpdates.length} rows.`,
    };
  }

  // Exchanges the stored Server-to-Server client credentials (base64 in CUSTOM_AUTH_KEY, sent as
  // HTTP Basic) for a 1-hour access token.
  private async getToken() {
    const zoomCronTokenExchanger = new HttpBubble({
      url: 'https://zoom.us/oauth/token',
      method: 'POST', authType: 'basic', responseType: 'text',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=account_credentials&account_id=' + ZOOM_ACCOUNT_ID,
    });
    return await zoomCronTokenExchanger.action();
  }

  // Lists the ended occurrences of the recurring masterclass meeting.
  private async listInstances(meetingId: string, token: string) {
    const zoomCronInstanceReader = new HttpBubble({
      url: 'https://api.zoom.us/v2/past_meetings/' + meetingId + '/instances',
      method: 'GET', responseType: 'text',
      headers: { Authorization: 'Bearer ' + token },
    });
    return await zoomCronInstanceReader.action();
  }

  // Fetches one page of a session's participant report.
  private async getParticipantsPage(uuid: string, token: string, nextPageToken: string) {
    const pageParam = nextPageToken ? '&next_page_token=' + encodeURIComponent(nextPageToken) : '';
    const zoomCronParticipantsReader = new HttpBubble({
      url: 'https://api.zoom.us/v2/report/meetings/' + encodeUuid(uuid) + '/participants?page_size=300' + pageParam,
      method: 'GET', responseType: 'text',
      headers: { Authorization: 'Bearer ' + token },
    });
    return await zoomCronParticipantsReader.action();
  }

  private async readMasterclasses() {
    const zoomCronMcReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Masterclasses' });
    return await zoomCronMcReader.action();
  }

  private async readSignups() {
    const zoomCronSignupsReader = new GoogleSheetsBubble({ operation: 'read_values', spreadsheet_id: ENGINE_SHEET_ID, range: 'Signups' });
    return await zoomCronSignupsReader.action();
  }

  private async markAttendance(rowIndex: number, attended: boolean) {
    const zoomCronAttendanceWriter = new GoogleSheetsBubble({
      operation: 'update_values', spreadsheet_id: ENGINE_SHEET_ID,
      range: `Signups!${COL_STATUS}${rowIndex}:${COL_ATTENDED}${rowIndex}`,
      values: [[attended ? 'Attended' : 'No-show', attended ? 'yes' : 'no']],
      value_input_option: 'RAW',
    });
    return await zoomCronAttendanceWriter.action();
  }
}
