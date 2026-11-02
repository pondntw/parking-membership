import { useState } from 'react';
import { rpc, searchTerm, unwrap } from '../lib/data.js';
import { money, PAYMENT_METHODS, quotaLabel } from '../lib/format.js';
import { useData, useDebounced } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';
import { Modal } from './FormModal.jsx';
import { useToast } from './Toast.jsx';

const findMembers = (text) => {
  const term = searchTerm(text);
  if (!term) return [];
  return unwrap(supabase.from('member_overview').select('id, code, full_name, phone')
    .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,code.ilike.%${term}%`)
    .order('id').limit(8));
};

export default function SubscribeModal({ member: fixedMember, onClose, onDone }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [member, setMember] = useState(fixedMember ?? null);
  const [packageId, setPackageId] = useState('');
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const term = useDebounced(search);
  const matches = useData(() => findMembers(term), [term]);
  const packages = useData(
    () => unwrap(supabase.from('packages').select('*').eq('is_active', true).order('name')),
    [],
  );

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sub = await rpc('subscribe', {
        p_member_id: member.id,
        p_package_id: Number(packageId),
        p_method: method || null,
        p_reference: reference || null,
      });
      toast(sub.status === 'paid' ? 'บันทึกการสมัครและรับชำระแล้ว' : 'บันทึกการสมัครแล้ว รอชำระเงิน');
      onDone();
      onClose();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="สมัคร / ต่ออายุสมาชิก" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <p className="form-error" role="alert">{error}</p>}

        {member ? (
          <div className="picked">
            <div>
              <strong>{member.full_name}</strong>
              <div className="muted">{member.code} · {member.phone}</div>
            </div>
            {!fixedMember && (
              <button type="button" className="btn btn-small" onClick={() => setMember(null)}>เปลี่ยน</button>
            )}
          </div>
        ) : (
          <div className="field">
            <label htmlFor="member-search">ค้นหาสมาชิก</label>
            <input id="member-search" autoFocus placeholder="ชื่อ เบอร์โทร หรือรหัสสมาชิก"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            {term && matches.data?.length === 0 && <small className="muted">ไม่พบสมาชิก</small>}
            <div className="pick-list">
              {matches.data?.map((row) => (
                <button type="button" key={row.id} onClick={() => setMember(row)}>
                  <strong>{row.full_name}</strong> <span className="muted">{row.code} · {row.phone}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="package">แพ็กเกจ</label>
          <select id="package" required value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">เลือกแพ็กเกจ</option>
            {packages.data?.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name} — {money(pkg.price)} / {pkg.duration_days} วัน ({quotaLabel(pkg.included_hours)})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="method">การชำระเงิน</label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">ชำระภายหลัง</option>
            {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <small className="muted">สมาชิกจะใช้งานได้เมื่อชำระเงินแล้ว</small>
        </div>

        {method && method !== 'cash' && (
          <div className="field">
            <label htmlFor="reference">เลขอ้างอิง</label>
            <input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={busy || !member}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
