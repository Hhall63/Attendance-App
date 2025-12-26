import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

const API_BASE: string = (window as any).__API_BASE__ || (typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : '');

interface SessionResponse {
  meta: { classDate: string; startTime: string; endTime: string };
  roster: { studentKey: string; displayName: string }[];
  config: { timezone: string };
}

const StudentPage: React.FC = () => {
  const { token } = useParams();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [studentKey, setStudentKey] = useState('');
  const [action, setAction] = useState<'Check-In' | 'Check-Out'>('Check-In');
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/session?token=${token}`);
        if (!res.ok) throw new Error('Session not found');
        const data = (await res.json()) as SessionResponse;
        setSession(data);
      } catch (err: any) {
        setError(err.message || 'Unable to load session');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const rosterOptions = useMemo(() => session?.roster || [], [session]);

  async function submit() {
    if (!studentKey) {
      setError('Please choose your name.');
      return;
    }
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, studentIdOrName: studentKey, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit');
      setSuccess(data.at || data.message || 'Recorded');
    } catch (err: any) {
      setError(err.message || 'Could not submit');
    }
  }

  if (loading) return <div className="container"><div className="card">Loading session…</div></div>;
  if (error) return <div className="container"><div className="card">{error}</div></div>;
  if (!session) return null;

  return (
    <div className="container">
      <div className="card">
        <h2>Class Attendance</h2>
        <p className="small">Date: {session.meta.classDate} · Time window: {session.meta.startTime} - {session.meta.endTime} ({session.config.timezone})</p>
        {success ? (
          <div className="alert">You are checked {action === 'Check-In' ? 'in' : 'out'} at {new Date(success).toLocaleTimeString('en-US', { timeZone: session.config.timezone })}. You may close this tab.</div>
        ) : (
          <>
            <label htmlFor="student">Student</label>
            <select id="student" value={studentKey} onChange={(e) => setStudentKey(e.target.value)}>
              <option value="">Select your name</option>
              {rosterOptions.map((r) => (
                <option key={r.studentKey} value={r.studentKey}>{r.displayName}</option>
              ))}
            </select>
            <label htmlFor="action">Action</label>
            <select id="action" value={action} onChange={(e) => setAction(e.target.value as any)}>
              <option value="Check-In">Check-In</option>
              <option value="Check-Out">Check-Out</option>
            </select>
            <div className="actions">
              <button onClick={submit}>Submit</button>
            </div>
          </>
        )}
        {error && <div className="alert" style={{ background: '#fee2e2', color: '#991b1b' }}>{error}</div>}
      </div>
    </div>
  );
};

export default StudentPage;
