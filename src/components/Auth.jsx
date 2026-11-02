import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { unwrap } from '../lib/data.js';
import { mockMode, supabase } from '../lib/supabase.js';
import { Loading } from './ui.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);
  const [staff, setStaff] = useState(undefined);
  const userId = session?.user.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) {
      setStaff(null);
      return undefined;
    }
    let stale = false;
    setStaff(undefined);
    unwrap(supabase.from('staff').select('full_name').eq('user_id', userId).maybeSingle())
      .then((row) => { if (!stale) setStaff(row); })
      .catch(() => { if (!stale) setStaff(null); });
    return () => { stale = true; };
  }, [userId]);

  const value = useMemo(() => ({
    session,
    staff,
    loading: session === undefined || (Boolean(userId) && staff === undefined),
  }), [session, staff, userId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

function Login() {
  const [email, setEmail] = useState(mockMode ? 'demo@example.com' : '');
  const [password, setPassword] = useState(mockMode ? 'demo' : '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.auth.signInWithPassword({ email, password });
    if (failure) {
      setError(failure.status === 400 ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
    }
    setBusy(false);
  };

  return (
    <main className="center-screen">
      <form className="card narrow login" onSubmit={submit}>
        <div className="brand brand-dark"><span className="brand-mark">P</span> ระบบจัดการที่จอดรถ</div>
        <h1>เข้าสู่ระบบเจ้าหน้าที่</h1>
        {mockMode && <p className="notice notice-warn">โหมดตัวอย่าง กดเข้าสู่ระบบได้เลย</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <label className="field">
          <span>อีเมล</span>
          <input type="email" required autoComplete="username" autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>รหัสผ่าน</span>
          <input type="password" required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </main>
  );
}

export function RequireAuth({ children }) {
  const { session, staff, loading } = useAuth();

  if (loading) {
    return (
      <main className="center-screen">
        {mockMode && session
          ? <p className="muted" role="status">กำลังเตรียมข้อมูลตัวอย่าง ครั้งแรกอาจใช้เวลาสักครู่…</p>
          : <Loading />}
      </main>
    );
  }
  if (!session) return <Login />;
  if (!staff) {
    return (
      <main className="center-screen">
        <div className="card narrow">
          <h1>บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน</h1>
          <p className="muted">{session.user.email} ยังไม่อยู่ในรายชื่อเจ้าหน้าที่ กรุณาติดต่อผู้ดูแลระบบ</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>ออกจากระบบ</button>
        </div>
      </main>
    );
  }
  return children;
}
