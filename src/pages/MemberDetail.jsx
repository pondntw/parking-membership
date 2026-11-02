import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FormModal } from '../components/FormModal.jsx';
import PayModal from '../components/PayModal.jsx';
import SubscribeModal from '../components/SubscribeModal.jsx';
import { useRun } from '../components/Toast.jsx';
import { Async, Badge, PageHeader } from '../components/ui.jsx';
import { rpc, unwrap } from '../lib/data.js';
import {
  date, dateTime, duration, MEMBER_STATUS, money, PAYMENT_KINDS, PAYMENT_METHODS, PAYMENT_STATUS,
  SUBSCRIPTION_KINDS, TERM_STATE, VEHICLE_TYPES,
} from '../lib/format.js';
import { useData } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';
import { memberFields } from './Members.jsx';

const vehicleFields = [
  { name: 'plate', label: 'ทะเบียนรถ', required: true, placeholder: 'เช่น 1กข1111' },
  { name: 'province', label: 'จังหวัด', required: true },
  {
    name: 'type',
    label: 'ประเภท',
    type: 'select',
    required: true,
    default: 'car',
    options: Object.entries(VEHICLE_TYPES).map(([value, label]) => ({ value, label })),
  },
  { name: 'brand', label: 'ยี่ห้อ' },
  { name: 'model', label: 'รุ่น' },
  { name: 'color', label: 'สี' },
];

const editMemberFields = [
  ...memberFields,
  {
    name: 'status',
    label: 'สถานะ',
    type: 'select',
    required: true,
    options: Object.entries(MEMBER_STATUS).map(([value, s]) => ({ value, label: s.label })),
  },
];

const loadMember = async (id) => {
  const [member, vehicles, terms, payments, visits] = await Promise.all([
    unwrap(supabase.from('member_overview').select('*').eq('id', id).maybeSingle()),
    unwrap(supabase.from('vehicles').select('*').eq('member_id', id).order('id')),
    unwrap(supabase.from('subscription_status').select('*').eq('member_id', id).order('start_date', { ascending: false })),
    unwrap(supabase.from('payment_history').select('*').eq('member_id', id).order('event_at', { ascending: false }).limit(20)),
    unwrap(supabase.from('visit_history').select('*').eq('member_id', id).order('entry_time', { ascending: false }).limit(20)),
  ]);
  return { member, vehicles, terms, payments, visits };
};

export default function MemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const run = useRun();
  const state = useData(() => loadMember(id), [id]);
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);

  const saveMember = async (values) => {
    await unwrap(supabase.from('members').update(values).eq('id', id).select());
    state.reload();
  };

  const removeMember = async (member) => {
    if (!window.confirm(`ลบสมาชิก ${member.full_name} และรถทั้งหมด?`)) return;
    const done = await run(() => unwrap(supabase.from('members').delete().eq('id', id).select()), 'ลบสมาชิกแล้ว');
    if (done) navigate('/members');
  };

  const saveVehicle = async (values, vehicleId) => {
    await unwrap(vehicleId
      ? supabase.from('vehicles').update(values).eq('id', vehicleId).select()
      : supabase.from('vehicles').insert({ ...values, member_id: Number(id) }).select());
    state.reload();
  };

  const removeVehicle = async (vehicle) => {
    if (!window.confirm(`ลบรถทะเบียน ${vehicle.plate}?`)) return;
    await run(() => unwrap(supabase.from('vehicles').delete().eq('id', vehicle.id).select()), 'ลบรถแล้ว');
    state.reload();
  };

  const cancelTerm = async (term) => {
    if (!window.confirm('ยกเลิกรายการนี้?')) return;
    await run(() => rpc('cancel_subscription', { p_subscription_id: term.id }), 'ยกเลิกรายการแล้ว');
    state.reload();
  };

  return (
    <Async state={state}>
      {({ member, vehicles, terms, payments, visits }) => (member ? (
        <>
          <PageHeader title={member.full_name}>
            <button className="btn" onClick={() => setModal({ type: 'member' })}>แก้ไข</button>
            <button className="btn btn-danger" onClick={() => removeMember(member)}>ลบ</button>
            <button className="btn btn-primary" onClick={() => setModal({ type: 'subscribe' })}>สมัคร / ต่ออายุ</button>
          </PageHeader>

          <section className="card">
            <dl className="facts facts-wide">
              <div><dt>รหัสสมาชิก</dt><dd>{member.code}</dd></div>
              <div><dt>สถานะ</dt><dd><Badge status={MEMBER_STATUS[member.status]} /></dd></div>
              <div><dt>เบอร์โทร</dt><dd>{member.phone}</dd></div>
              <div><dt>อีเมล</dt><dd>{member.email ?? '–'}</dd></div>
              <div><dt>สมาชิกถึง</dt><dd>{date(member.paid_until)}</dd></div>
              <div><dt>ที่อยู่</dt><dd>{member.address ?? '–'}</dd></div>
            </dl>
          </section>

          <section className="card table-card">
            <header className="card-head">
              <h2>ยานพาหนะ</h2>
              <button className="btn btn-small" onClick={() => setModal({ type: 'vehicle' })}>เพิ่มรถ</button>
            </header>
            {vehicles.length === 0 ? <p className="empty">ยังไม่มีรถ</p> : (
              <table>
                <thead>
                  <tr><th>ทะเบียน</th><th>จังหวัด</th><th>ประเภท</th><th>รายละเอียด</th><th aria-label="จัดการ" /></tr>
                </thead>
                <tbody>
                  {vehicles.map((v) => (
                    <tr key={v.id}>
                      <td><strong>{v.plate}</strong></td>
                      <td>{v.province}</td>
                      <td>{VEHICLE_TYPES[v.type]}</td>
                      <td>{[v.brand, v.model, v.color].filter(Boolean).join(' ') || '–'}</td>
                      <td className="row-actions">
                        <button className="btn btn-small" onClick={() => setModal({ type: 'vehicle', vehicle: v })}>แก้ไข</button>
                        <button className="btn btn-small btn-danger" onClick={() => removeVehicle(v)}>ลบ</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card table-card">
            <header className="card-head"><h2>รอบสมาชิก</h2></header>
            {terms.length === 0 ? <p className="empty">ยังไม่เคยสมัคร</p> : (
              <table>
                <thead>
                  <tr><th>แพ็กเกจ</th><th>ประเภท</th><th>เริ่ม</th><th>สิ้นสุด</th><th>ราคา</th><th>สถานะ</th><th aria-label="จัดการ" /></tr>
                </thead>
                <tbody>
                  {terms.map((t) => (
                    <tr key={t.id}>
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
                            <button className="btn btn-small" onClick={() => cancelTerm(t)}>ยกเลิก</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card table-card">
            <header className="card-head">
              <h2>การเข้าใช้ล่าสุด</h2>
              <Link to={`/history?member=${member.code}`}>ดูทั้งหมด</Link>
            </header>
            {visits.length === 0 ? <p className="empty">ยังไม่มีประวัติ</p> : (
              <table>
                <thead>
                  <tr><th>ทะเบียน</th><th>ช่องจอด</th><th>เข้า</th><th>ออก</th><th>ระยะเวลา</th><th>ค่าบริการ</th></tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={v.id}>
                      <td>{v.plate}</td>
                      <td>{v.zone_name} / {v.spot_code}</td>
                      <td>{dateTime(v.entry_time)}</td>
                      <td>{v.exit_time ? dateTime(v.exit_time) : 'ยังจอดอยู่'}</td>
                      <td>{duration(v.duration_min)}</td>
                      <td>{v.fee == null ? '–' : money(v.fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card table-card">
            <header className="card-head"><h2>การชำระเงินล่าสุด</h2></header>
            {payments.length === 0 ? <p className="empty">ยังไม่มีรายการ</p> : (
              <table>
                <thead>
                  <tr><th>วันที่</th><th>รายการ</th><th>จำนวนเงิน</th><th>วิธีชำระ</th><th>สถานะ</th><th aria-label="จัดการ" /></tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{dateTime(p.event_at)}</td>
                      <td>{PAYMENT_KINDS[p.kind]}</td>
                      <td>{money(p.amount)}</td>
                      <td>{PAYMENT_METHODS[p.method] ?? '–'}</td>
                      <td><Badge status={PAYMENT_STATUS[p.status]} /></td>
                      <td className="row-actions">
                        {p.status === 'pending' && (
                          <button className="btn btn-small btn-primary"
                            onClick={() => setModal({ type: 'pay', paymentId: p.id, amount: p.amount })}>
                            รับชำระ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {modal?.type === 'member' && (
            <FormModal title="แก้ไขสมาชิก" fields={editMemberFields} initial={member} onSubmit={saveMember} onClose={close} />
          )}
          {modal?.type === 'vehicle' && (
            <FormModal
              title={modal.vehicle ? 'แก้ไขรถ' : 'เพิ่มรถ'}
              fields={vehicleFields}
              initial={modal.vehicle}
              onSubmit={(values) => saveVehicle(values, modal.vehicle?.id)}
              onClose={close}
            />
          )}
          {modal?.type === 'subscribe' && <SubscribeModal member={member} onClose={close} onDone={state.reload} />}
          {modal?.type === 'pay' && (
            <PayModal paymentId={modal.paymentId} amount={modal.amount} onClose={close} onDone={state.reload} />
          )}
        </>
      ) : (
        <p className="empty">ไม่พบสมาชิก <Link to="/members">กลับไปหน้าสมาชิก</Link></p>
      ))}
    </Async>
  );
}
