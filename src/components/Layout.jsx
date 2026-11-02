import { NavLink, Outlet } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './Auth.jsx';

const NAV = [
  { to: '/', label: 'ภาพรวม', end: true },
  { to: '/gate', label: 'เข้า–ออก' },
  { to: '/spots', label: 'ช่องจอด' },
  { to: '/members', label: 'สมาชิก' },
  { to: '/subscriptions', label: 'สมัคร/ต่ออายุ' },
  { to: '/packages', label: 'แพ็กเกจ' },
  { to: '/payments', label: 'การชำระเงิน' },
  { to: '/history', label: 'ประวัติการเข้าใช้' },
];

export default function Layout() {
  const { staff } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">P</span> ที่จอดรถสมาชิก</div>
        <nav aria-label="เมนูหลัก">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>{staff.full_name}</span>
          <button className="link-light" onClick={() => supabase.auth.signOut()}>ออกจากระบบ</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
