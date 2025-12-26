import { Env, RosterEntry, ClassConfig, AttendanceLogRow, DailySummaryRow } from './types';

interface GraphTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function getAccessToken(env: Env): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    client_secret: env.MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Graph token error: ${res.status}`);
  }
  const json = (await res.json()) as GraphTokenResponse;
  return json.access_token;
}

function workbookBase(env: Env): string {
  if (env.EXCEL_ITEM_ID) {
    return `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(env.EXCEL_ITEM_ID)}/workbook`;
  }
  if (env.EXCEL_FILE_PATH) {
    return `${GRAPH_BASE}/me/drive/root:${env.EXCEL_FILE_PATH}:/workbook`;
  }
  throw new Error('Workbook identifier missing');
}

async function graphFetch(env: Env, path: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken(env);
  const res = await fetch(`${workbookBase(env)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph request failed ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function ensureTables(env: Env) {
  const tables = [
    { name: 'tblRoster', address: 'Roster!A1:C1', headers: ['studentKey', 'displayName', 'active'] },
    { name: 'tblConfig', address: 'ClassConfig!A1:E1', headers: ['classStartTime', 'classEndTime', 'timezone', 'tardyMinutesLate', 'earlyLeaveMinutes'] },
    { name: 'tblAttendanceLog', address: 'AttendanceLog!A1:G1', headers: ['serverTimestampISO', 'classDate', 'studentKey', 'displayName', 'action', 'userAgent', 'ipHash'] },
    { name: 'tblDailySummary', address: 'DailySummary!A1:I1', headers: ['classDate', 'studentKey', 'displayName', 'firstCheckInISO', 'lastCheckOutISO', 'computedStatus', 'overrideStatus', 'finalStatus', 'notes'] },
  ];

  const current = await graphFetch(env, '/tables');
  const existingNames: string[] = current?.value?.map((t: any) => t.name) || [];

  for (const tbl of tables) {
    if (!existingNames.includes(tbl.name)) {
      await graphFetch(env, '/tables/add', {
        method: 'POST',
        body: JSON.stringify({ address: tbl.address, hasHeaders: true }),
      });
      await graphFetch(env, `/tables/${tbl.name}/columns/add`, {
        method: 'POST',
        body: JSON.stringify({ values: [tbl.headers] }),
      });
      await graphFetch(env, `/tables/${tbl.name}`, { method: 'PATCH', body: JSON.stringify({ name: tbl.name }) });
    }
  }
}

export async function getRoster(env: Env): Promise<RosterEntry[]> {
  const data = await graphFetch(env, '/tables/tblRoster/rows');
  const rows: any[] = data?.value || [];
  return rows
    .map((r) => ({
      studentKey: String(r.values?.[0]?.[0] ?? '').trim(),
      displayName: String(r.values?.[0]?.[1] ?? '').trim(),
      active: String(r.values?.[0]?.[2] ?? 'TRUE').toUpperCase() !== 'FALSE',
    }))
    .filter((r) => r.studentKey && r.displayName && r.active);
}

export async function getConfig(env: Env): Promise<ClassConfig> {
  const data = await graphFetch(env, '/tables/tblConfig/rows');
  const row = data?.value?.[0]?.values?.[0];
  return {
    classStartTime: row?.[0] || '09:00',
    classEndTime: row?.[1] || '12:00',
    timezone: row?.[2] || 'America/New_York',
    tardyMinutesLate: Number(row?.[3] || 5),
    earlyLeaveMinutes: Number(row?.[4] || 30),
  };
}

export async function appendAttendance(env: Env, row: AttendanceLogRow) {
  await graphFetch(env, '/tables/tblAttendanceLog/rows/add', {
    method: 'POST',
    body: JSON.stringify({ values: [[row.serverTimestampISO, row.classDate, row.studentKey, row.displayName, row.action, row.userAgent, row.ipHash]] }),
  });
}

export async function listAttendanceByDate(env: Env, classDate: string): Promise<AttendanceLogRow[]> {
  const data = await graphFetch(env, '/tables/tblAttendanceLog/rows');
  const rows: any[] = data?.value || [];
  return rows
    .map((r) => r.values?.[0])
    .filter((r) => r?.[1] === classDate)
    .map((r) => ({
      serverTimestampISO: r[0],
      classDate: r[1],
      studentKey: r[2],
      displayName: r[3],
      action: r[4],
      userAgent: r[5],
      ipHash: r[6],
    }));
}

export async function listDailySummary(env: Env): Promise<{ rows: DailySummaryRow[]; raw: any[] }> {
  const data = await graphFetch(env, '/tables/tblDailySummary/rows');
  const rows: any[] = data?.value || [];
  const parsed = rows.map((r) => {
    const v = r.values?.[0];
    return {
      classDate: v?.[0],
      studentKey: v?.[1],
      displayName: v?.[2],
      firstCheckInISO: v?.[3] || '',
      lastCheckOutISO: v?.[4] || '',
      computedStatus: v?.[5] || '',
      overrideStatus: v?.[6] || '',
      finalStatus: v?.[7] || '',
      notes: v?.[8] || '',
    } as DailySummaryRow;
  });
  return { rows: parsed, raw: rows };
}

export async function addSummaryRows(env: Env, rows: DailySummaryRow[]) {
  if (!rows.length) return;
  const values = rows.map((r) => [r.classDate, r.studentKey, r.displayName, r.firstCheckInISO, r.lastCheckOutISO, r.computedStatus, r.overrideStatus ?? '', r.finalStatus, r.notes ?? '']);
  await graphFetch(env, '/tables/tblDailySummary/rows/add', {
    method: 'POST',
    body: JSON.stringify({ values }),
  });
}

export async function updateSummaryRow(env: Env, rowId: string, row: DailySummaryRow) {
  await graphFetch(env, `/tables/tblDailySummary/rows/${rowId}/values`, {
    method: 'PATCH',
    body: JSON.stringify({ values: [[row.classDate, row.studentKey, row.displayName, row.firstCheckInISO, row.lastCheckOutISO, row.computedStatus, row.overrideStatus ?? '', row.finalStatus, row.notes ?? '']] }),
  });
}
