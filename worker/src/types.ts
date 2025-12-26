export interface Env {
  ADMIN_KEY: string;
  MS_TENANT_ID: string;
  MS_CLIENT_ID: string;
  MS_CLIENT_SECRET: string;
  EXCEL_ITEM_ID?: string;
  EXCEL_FILE_PATH?: string;
  KV_SESSIONS: KVNamespace;
  IP_HASH_SALT: string;
}

export interface RosterEntry {
  studentKey: string;
  displayName: string;
  active?: boolean;
}

export interface ClassConfig {
  classStartTime: string; // HH:MM
  classEndTime: string; // HH:MM
  timezone: string;
  tardyMinutesLate: number;
  earlyLeaveMinutes: number;
}

export interface AttendanceLogRow {
  serverTimestampISO: string;
  classDate: string;
  studentKey: string;
  displayName: string;
  action: 'Check-In' | 'Check-Out';
  userAgent: string;
  ipHash: string;
}

export interface DailySummaryRow {
  classDate: string;
  studentKey: string;
  displayName: string;
  firstCheckInISO: string;
  lastCheckOutISO: string;
  computedStatus: string;
  overrideStatus?: string;
  finalStatus: string;
  notes?: string;
}

export interface SessionMeta {
  token: string;
  classDate: string;
  createdAt: string;
  expiresAt: string;
  startTime: string;
  endTime: string;
}
