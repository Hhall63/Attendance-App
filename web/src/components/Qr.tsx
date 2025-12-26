import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  value: string;
  size?: number;
}

const Qr: React.FC<Props> = ({ value, size = 240 }) => {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    QRCode.toDataURL(value, { width: size }).then(setUrl).catch(() => setUrl(''));
  }, [value, size]);
  if (!url) return null;
  return <img src={url} alt="QR code" style={{ width: size, height: size }} />;
};

export default Qr;
