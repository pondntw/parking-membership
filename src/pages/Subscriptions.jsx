import { useState } from 'react';
import { Link } from 'react-router-dom';
import PayModal from '../components/PayModal.jsx';
import SubscribeModal from '../components/SubscribeModal.jsx';
import { useRun } from '../components/Toast.jsx';
import { Async, Badge, PageHeader, TableNote } from '../components/ui.jsx';
import { LIST_LIMIT, rpc, unwrapList } from '../lib/data.js';
import { date, money, SUBSCRIPTION_KINDS, TERM_STATE } from '../lib/format.js';
import { useData } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';

const FILTERS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'pending', label: 'รอชำระ' },
  { value: 'active', label: 'ใช้งานอยู่' },
  { value: 'upcoming', label: 'รอเริ่มรอบ' },
  { value: 'expired', label: 'หมดอายุ' },
];

const listTerms = (filter) => {
  let query = supabase.from('subscription_status').select('*', { count: 'exact' })
    .order('id', { ascending: false }).limit(LIST_LIMIT);
  if (filter !== 'all') query = query.eq('state', filter);
  return unwrapList(query);
};

export default function Subscriptions() {
  const run = useRun();
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const state = useData(() => listTerms(filter), [filter]);
  const close = () => setModal(null);

  const cancel = async (term) => {
    if (!window.confirm(`ยกเลิกรายการของ ${term.member_name}?`)) return;
    await run(() => rpc('cancel_subscription', { p_subscription_id: term.id }), 'ยกเลิกรายการแล้ว');
    state.reload();
  };

  return (
    <>
      <PageHeader title="สมัครและต่ออายุสมาชิก">
        <button className="btn btn-primary" onClick={() => setModal({ type: 'subscribe' })}>สมัคร / ต่ออายุ</button>
      </PageHeader>

      <div className="tabs" role="group" aria-label="กรองสถานะ">
        {FILTERS.map((f) => (
          <button key={f.value} className={filter === f.value ? 'tab tab-active' : 'tab'}
            aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      <Async state={state} empty="ไม่มีรายการ" isEmpty={(d) => d.rows.length === 0}>
        {({ rows, total }) => (
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>สมาชิก</th><th>แพ็กเกจ</th><th>ประเภท</th><th>เริ่ม</th><th>สิ้นสุด</th>
                  <th>ราคา</th><th>สถานะ</th><th aria-label="จัดการ" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td><Link to={`/members/${t.member_id}`}>{t.member_name}</Link></td>
                    <td>{t.package_name}</td>
                    <td>{SUBSCRIPTION_KINDS[t.kind]}</td>
                    <td>{date(t.start_date)}</td>
                    <td>{date(t.end_date)}</td>
                    <td>{money(t.price)}</td>
                    <td><Badge status={TERM_STATE[t.state]} /></td>
                    <td className="row-actions">
                      {t.state === 'pending' && (
                        <>
                          <button className="btn btn-small btn-primary"
                            onClick={() => setModal({ type: 'pay', paymentId: t.payment_id, amount: t.price })}>
                            รับชำระ
                          </button>
                          <button className="btn btn-small" onClick={() => cancel(t)}>ยกเลิก</button>
                        </>
                      )}
                      {t.state !== 'pending' && t.state !== 'cancelled' && (
                        <button className="btn btn-small" onClick={() => setModal({
                          type: 'subscribe',
                          member: { id: t.member_id, code: t.member_code, full_name: t.member_name, phone: t.member_phone },
                        })}>
                          ต่ออายุ
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TableNote shown={rows.length} total={total} />
          </div>
        )}
      </Async>

      {modal?.type === 'subscribe' && <SubscribeModal member={modal.member} onClose={close} onDone={state.reload} />}
      {modal?.type === 'pay' && (
        <PayModal paymentId={modal.paymentId} amount={modal.amount} onClose={close} onDone={state.reload} />
      )}
    </>
  );
}
