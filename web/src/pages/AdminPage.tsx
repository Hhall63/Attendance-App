import React, { useMemo, useState } from 'react';
import Qr from '../components/Qr';

const API_BASE: string = (window as any).__API_BASE__ || (typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : '');

interface StartResponse { token: string; sessionUrl: string; expiresAt: string; }
interface CloseResponse { classDate: string; counts: Record<string, number>; }

const AdminPage: React.FC = () => {
  const [adminKey, setAdminKey] = useState('');
  const [session, setSession] = useState<StartResponse | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const canUse = useMemo(() => adminKey.trim().length > 0, [adminKey]);

  async function startSession() {
    if (!canUse) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/start-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start');
      setSession(data);
      setStatus(`Session active. Expires ${new Date(data.expiresAt).toLocaleString()}`);
    } catch (err: any) {
      setError(err.message || 'Could not start session');
    } finally {
      setLoading(false);
    }
  }

  async function closeSession() {
    if (!canUse) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/close-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      });
      const data = (await res.json()) as CloseResponse;
      if (!res.ok) throw new Error((data as any).error || 'Failed to close');
      setStatus(`Summary for ${data.classDate}: Present ${data.counts.Present || 0}, Tardy ${data.counts.Tardy || 0}, Absent ${data.counts.Absent || 0}`);
    } catch (err: any) {
      setError(err.message || 'Could not close session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h2>Admin</h2>
        <label htmlFor="key">Admin Key</label>
        <input id="key" type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} placeholder="Enter admin key" />
        <div className="actions">
          <button onClick={startSession} disabled={!canUse || loading}>Start Today's Session</button>
          <button onClick={closeSession} disabled={!canUse || loading}>Close Today’s Session</button>
        </div>
        {status && <div className="alert">{status}</div>}
        {error && <div className="alert" style={{ background: '#fee2e2', color: '#991b1b' }}>{error}</div>}
        {session && (
          <div className="qr-box" style={{ marginTop: '1rem' }}>
            <p>Share this link:</p>
            <code>{session.sessionUrl}</code>
            <div style={{ margin: '1rem auto' }}>
              <Qr value={session.sessionUrl} />
            </div>
            <div className="actions" style={{ justifyContent: 'center' }}>
              <a href={`/print/${session.token}`} target="_blank" rel="noreferrer">
                <button type="button">Print QR</button>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPage;
