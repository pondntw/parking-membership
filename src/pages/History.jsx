import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Async, Badge, PageHeader, TableNote } from '../components/ui.jsx';
import { LIST_LIMIT, plateTerm, searchTerm, unwrapList, withinDates } from '../lib/data.js';
import { dateTime, duration, money, PAYMENT_STATUS } from '../lib/format.js';
import { useData, useDebounced } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';

const listVisits = ({ text, from, to, parkedOnly }) => {
  let query = supabase.from('visit_history').select('*', { count: 'exact' })
    .order('entry_time', { ascending: false }).limit(LIST_LIMIT);
  const term = searchTerm(text);
  if (term) {
    query = query.or(`plate.ilike.%${plateTerm(text)}%,member_name.ilike.%${term}%,member_code.ilike.%${term}%`);
  }
  if (parkedOnly) query = query.is('exit_time', null);
  return unwrapList(withinDates(query, 'entry_time', from, to));
};

export default function History() {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({
    text: params.get('member') ?? '', from: '', to: '', parkedOnly: false,
  });
  const text = useDebounced(filters.text);
  const { from, to, parkedOnly } = filters;
  const state = useData(() => listVisits({ text, from, to, parkedOnly }), [text, from, to, parkedOnly]);
  const set = (change) => setFilters((prev) => ({ ...prev, ...change }));

  return (
    <>
      <PageHeader title="ประวัติการเข้าใช้บริการ" />

      <div className="filters">
        <input className="search" type="search" aria-label="ค้นหาประวัติ" placeholder="ทะเบียน ชื่อ หรือรหัสสมาชิก"
          value={filters.text} onChange={(e) => set({ text: e.target.value })} />
        <label>ตั้งแต่ <input type="date" value={from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>ถึง <input type="date" value={to} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="check">
          <input type="checkbox" checked={parkedOnly} onChange={(e) => set({ parkedOnly: e.target.checked })} />
          เฉพาะรถที่ยังจอดอยู่
        </label>
      </div>

      <Async state={state} empty="ไม่พบประวัติ" isEmpty={(d) => d.rows.length === 0}>
        {({ rows, total }) => (
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>เข้า</th><th>ออก</th><th>ทะเบียน</th><th>สมาชิก</th><th>ช่องจอด</th>
                  <th>ระยะเวลา</th><th>ค่าบริการ</th><th>การชำระ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td>{dateTime(v.entry_time)}</td>
                    <td>{v.exit_time ? dateTime(v.exit_time) : 'ยังจอดอยู่'}</td>
                    <td><strong>{v.plate}</strong> <span className="muted">{v.province}</span></td>
                    <td><Link to={`/members/${v.member_id}`}>{v.member_name}</Link></td>
                    <td>{v.zone_name} / {v.spot_code}</td>
                    <td>{duration(v.duration_min)}</td>
                    <td>{v.fee == null ? '–' : money(v.fee)}</td>
                    <td>{v.payment_status ? <Badge status={PAYMENT_STATUS[v.payment_status]} /> : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TableNote shown={rows.length} total={total} />
          </div>
        )}
      </Async>
    </>
  );
}
