import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Qr from '../components/Qr';

const API_BASE: string = (window as any).__API_BASE__ || (typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : '');

interface SessionResponse { meta: { classDate: string; startTime: string; endTime: string }; }

const PrintPage: React.FC = () => {
  const { token } = useParams();
  const [session, setSession] = useState<SessionResponse | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch(`${API_BASE}/api/session?token=${token}`);
      if (res.ok) setSession(await res.json());
    }
    load();
  }, [token]);

  const link = `${window.location.origin}/t/${token}`;

  return (
    <div className="container" style={{ maxWidth: '900px' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <h1>Scan to Check In / Out</h1>
        <p className="small">Use your phone camera. Keep this page printed in the classroom.</p>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '1rem 0' }}>
          <Qr value={link} size={320} />
        </div>
        <p>{link}</p>
        {session && <p className="small">Date: {session.meta.classDate} · Valid {session.meta.startTime} - {session.meta.endTime}</p>}
        <p className="small">If the QR fails, type the URL above in your browser.</p>
      </div>
    </div>
  );
};

export default PrintPage;
