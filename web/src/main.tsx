import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import StudentPage from './pages/StudentPage';
import AdminPage from './pages/AdminPage';
import PrintPage from './pages/PrintPage';

const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/t/:token" element={<StudentPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/print/:token" element={<PrintPage />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  </BrowserRouter>
);

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
