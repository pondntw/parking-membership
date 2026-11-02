import { Link } from 'react-router-dom';
import { Async, PageHeader, Stat } from '../components/ui.jsx';
import { rpc } from '../lib/data.js';
import { date, money, VEHICLE_TYPES } from '../lib/format.js';
import { useData } from '../lib/hooks.js';

function ZoneRow({ zone }) {
  const available = zone.total - zone.occupied - zone.out_of_service;
  const share = (count) => (zone.total ? `${(count / zone.total) * 100}%` : '0');

  return (
    <li className="zone-row">
      <div className="zone-row-head">
        <strong>{zone.name}</strong>
        <span className="muted">{VEHICLE_TYPES[zone.vehicle_type]}</span>
      </div>
      <div className="meter" role="img" aria-label={`${zone.name} มีรถจอด ${zone.occupied} จาก ${zone.total} ช่อง`}>
        <span className="meter-occupied" style={{ width: share(zone.occupied) }} />
        <span className="meter-closed" style={{ width: share(zone.out_of_service) }} />
      </div>
      <div className="zone-row-foot">
        ว่าง {available} · มีรถจอด {zone.occupied} · ปิดใช้งาน {zone.out_of_service} · ทั้งหมด {zone.total} ช่อง
      </div>
    </li>
  );
}

export default function Dashboard() {
  const state = useData(() => rpc('dashboard_summary'), [], { refreshMs: 15000 });

  return (
    <>
      <PageHeader title="ภาพรวม" />
      <Async state={state}>
        {(summary) => {
          const total = summary.zones.reduce((sum, z) => sum + z.total, 0);
          const occupied = summary.zones.reduce((sum, z) => sum + z.occupied, 0);
          const closed = summary.zones.reduce((sum, z) => sum + z.out_of_service, 0);

          return (
            <>
              <section className="stats" aria-label="สรุปวันนี้">
                <Stat label="ช่องว่างตอนนี้" value={total - occupied - closed} hint={`จากทั้งหมด ${total} ช่อง`} />
                <Stat label="รถในลาน" value={occupied} hint={`เข้าวันนี้ ${summary.entries_today} ครั้ง`} />
                <Stat label="รายรับวันนี้" value={money(summary.revenue_today)} />
                <Stat label="รอชำระ" value={money(summary.pending_amount)} hint={`${summary.pending_count} รายการ`} />
                <Stat label="สมาชิกที่ใช้งานอยู่" value={summary.active_members} />
              </section>

              <div className="two-col">
                <section className="card">
                  <h2>สถานะแต่ละโซน</h2>
                  {summary.zones.length === 0 ? (
                    <p className="empty">ยังไม่มีโซน <Link to="/spots">เพิ่มโซนและช่องจอด</Link></p>
                  ) : (
                    <ul className="zone-list">
                      {summary.zones.map((zone) => <ZoneRow key={zone.id} zone={zone} />)}
                    </ul>
                  )}
                </section>

                <section className="card">
                  <h2>สมาชิกใกล้หมดอายุ (7 วัน)</h2>
                  {summary.expiring.length === 0 ? (
                    <p className="empty">ไม่มีสมาชิกที่ใกล้หมดอายุ</p>
                  ) : (
                    <ul className="simple-list">
                      {summary.expiring.map((member) => (
                        <li key={member.id}>
                          <Link to={`/members/${member.id}`}>{member.full_name}</Link>
                          <span className="muted">{member.phone}</span>
                          <span>{date(member.end_date)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
