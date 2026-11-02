import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './components/Auth.jsx';
import Layout from './components/Layout.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { configured } from './lib/supabase.js';
import Dashboard from './pages/Dashboard.jsx';
import Gate from './pages/Gate.jsx';
import History from './pages/History.jsx';
import MemberDetail from './pages/MemberDetail.jsx';
import Members from './pages/Members.jsx';
import Packages from './pages/Packages.jsx';
import Payments from './pages/Payments.jsx';
import Spots from './pages/Spots.jsx';
import Subscriptions from './pages/Subscriptions.jsx';

export default function App() {
  if (!configured) {
    return (
      <main className="center-screen">
        <div className="card narrow">
          <h1>ยังไม่ได้เชื่อมต่อ Supabase</h1>
          <p className="muted">
            ตั้งค่า <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> แล้ว
            build ใหม่อีกครั้ง
          </p>
        </div>
      </main>
    );
  }

  return (
    <ToastProvider>
      <AuthProvider>
        <RequireAuth>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="gate" element={<Gate />} />
              <Route path="spots" element={<Spots />} />
              <Route path="members" element={<Members />} />
              <Route path="members/:id" element={<MemberDetail />} />
              <Route path="packages" element={<Packages />} />
              <Route path="subscriptions" element={<Subscriptions />} />
              <Route path="payments" element={<Payments />} />
              <Route path="history" element={<History />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </RequireAuth>
      </AuthProvider>
    </ToastProvider>
  );
}
