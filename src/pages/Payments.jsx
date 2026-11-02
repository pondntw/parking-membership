import { useState } from 'react';
import { Link } from 'react-router-dom';
import PayModal from '../components/PayModal.jsx';
import { Async, Badge, PageHeader, Stat, TableNote } from '../components/ui.jsx';
import { LIST_LIMIT, rpc, unwrapList, withinDates } from '../lib/data.js';
import { dateTime, money, PAYMENT_KINDS, PAYMENT_METHODS, PAYMENT_STATUS } from '../lib/format.js';
import { useData } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';

const FILTERS = [
  { value: 'pending', label: 'รอชำระ' },
  { value: 'paid', label: 'ชำระแล้ว' },
  { value: 'all', label: 'ทั้งหมด' },
];

const loadPayments = async ({ status, from, to }) => {
  let query = supabase.from('payment_history').select('*', { count: 'exact' })
    .order('event_at', { ascending: false }).limit(LIST_LIMIT);
  if (status !== 'all') query = query.eq('status', status);
  const [list, paidTotal, pendingTotal] = await Promise.all([
    unwrapList(withinDates(query, 'event_at', from, to)),
    rpc('payment_total', { p_status: 'paid', p_from: from || null, p_to: to || null }),
    rpc('payment_total', { p_status: 'pending', p_from: from || null, p_to: to || null }),
  ]);
  return { ...list, paidTotal, pendingTotal };
};

export default function Payments() {
  const [filters, setFilters] = useState({ status: 'pending', from: '', to: '' });
  const [paying, setPaying] = useState(null);
  const state = useData(() => loadPayments(filters), [filters]);
  const set = (change) => setFilters((prev) => ({ ...prev, ...change }));

  return (
    <>
      <PageHeader title="การชำระเงิน" />

      <div className="filters">
        <div className="tabs" role="group" aria-label="กรองสถานะ">
          {FILTERS.map((f) => (
            <button key={f.value} className={filters.status === f.value ? 'tab tab-active' : 'tab'}
              aria-pressed={filters.status === f.value} onClick={() => set({ status: f.value })}>
              {f.label}
            </button>
          ))}
        </div>
        <label>ตั้งแต่ <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>ถึง <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
      </div>

      <Async state={state}>
        {({ rows, total, paidTotal, pendingTotal }) => (
          <>
            <section className="stats" aria-label="ยอดรวมในช่วงที่เลือก">
              <Stat label="รับชำระแล้ว" value={money(paidTotal)} />
              <Stat label="รอชำระ" value={money(pendingTotal)} />
            </section>

            {rows.length === 0 ? <p className="empty">ไม่มีรายการ</p> : (
              <div className="card table-card">
                <table>
                  <thead>
                    <tr>
                      <th>วันที่</th><th>สมาชิก</th><th>รายการ</th><th>จำนวนเงิน</th>
                      <th>วิธีชำระ</th><th>อ้างอิง</th><th>สถานะ</th><th aria-label="จัดการ" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td>{dateTime(p.event_at)}</td>
                        <td><Link to={`/members/${p.member_id}`}>{p.member_name}</Link></td>
                        <td>{PAYMENT_KINDS[p.kind]}</td>
                        <td>{money(p.amount)}</td>
                        <td>{PAYMENT_METHODS[p.method] ?? '–'}</td>
                        <td>{p.reference ?? '–'}</td>
                        <td><Badge status={PAYMENT_STATUS[p.status]} /></td>
                        <td className="row-actions">
                          {p.status === 'pending' && (
                            <button className="btn btn-small btn-primary" onClick={() => setPaying(p)}>รับชำระ</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TableNote shown={rows.length} total={total} />
              </div>
            )}
          </>
        )}
      </Async>

      {paying && (
        <PayModal paymentId={paying.id} amount={paying.amount}
          onClose={() => setPaying(null)} onDone={state.reload} />
      )}
    </>
  );
}
