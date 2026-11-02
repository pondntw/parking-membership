import { useState } from 'react';
import { FormModal } from '../components/FormModal.jsx';
import { useRun } from '../components/Toast.jsx';
import { Async, PageHeader } from '../components/ui.jsx';
import { rpc, unwrap } from '../lib/data.js';
import { accessHours, money, quotaLabel } from '../lib/format.js';
import { useData } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';

const packageFields = (zones) => [
  { name: 'name', label: 'ชื่อแพ็กเกจ', required: true },
  { name: 'price', label: 'ราคา (บาท)', type: 'number', min: 0, step: '0.01', required: true },
  { name: 'duration_days', label: 'ระยะเวลา (วัน)', type: 'number', min: 1, required: true, default: 30 },
  { name: 'max_vehicles', label: 'จำนวนรถที่ลงทะเบียนได้', type: 'number', min: 1, required: true, default: 1 },
  { name: 'included_hours', label: 'ชั่วโมงจอดต่อรอบ', type: 'number', min: 0, hint: 'เว้นว่าง = ไม่จำกัด' },
  { name: 'overage_rate', label: 'ค่าจอดส่วนเกิน (บาท/ชั่วโมง)', type: 'number', min: 0, step: '0.01', required: true, default: 0 },
  { name: 'access_start', label: 'เข้าจอดได้ตั้งแต่', type: 'time', hint: 'เว้นว่างทั้งสองช่อง = ตลอดวัน' },
  { name: 'access_end', label: 'เข้าจอดได้ถึง', type: 'time' },
  {
    name: 'zone_ids',
    label: 'โซนที่ใช้ได้',
    type: 'checkgroup',
    options: zones.map((z) => ({ value: z.id, label: z.name })),
    hint: 'ไม่เลือกเลย = ใช้ได้ทุกโซน',
  },
  { name: 'is_active', label: 'เปิดให้สมัคร', type: 'checkbox', default: true },
];

const loadPackages = async () => {
  const [packages, zones] = await Promise.all([
    unwrap(supabase.from('packages').select('*, package_zones(zone_id)').order('name')),
    unwrap(supabase.from('zones').select('id, name').order('name')),
  ]);
  return { packages, zones };
};

function PackageCard({ pkg, zones, onEdit, onRemove }) {
  const zoneIds = pkg.package_zones.map((pz) => pz.zone_id);
  const zoneNames = zones.filter((z) => zoneIds.includes(z.id)).map((z) => z.name).join(', ');

  return (
    <article className={pkg.is_active ? 'card package' : 'card package package-closed'}>
      <header>
        <h2>{pkg.name}</h2>
        {!pkg.is_active && <span className="badge badge-neutral">ปิดรับสมัคร</span>}
      </header>
      <div className="package-price">{money(pkg.price)} <span className="muted">/ {pkg.duration_days} วัน</span></div>
      <dl className="facts">
        <div><dt>ชั่วโมงจอด</dt><dd>{quotaLabel(pkg.included_hours)}</dd></div>
        <div><dt>ส่วนเกิน</dt><dd>{money(pkg.overage_rate)}/ชม.</dd></div>
        <div><dt>จำนวนรถ</dt><dd>{pkg.max_vehicles} คัน</dd></div>
        <div><dt>เวลาเข้าจอด</dt><dd>{accessHours(pkg)}</dd></div>
        <div><dt>โซน</dt><dd>{zoneNames || 'ทุกโซน'}</dd></div>
      </dl>
      <div className="row-actions">
        <button className="btn btn-small" onClick={onEdit}>แก้ไข</button>
        <button className="btn btn-small btn-danger" onClick={onRemove}>ลบ</button>
      </div>
    </article>
  );
}

export default function Packages() {
  const run = useRun();
  const state = useData(loadPackages, []);
  const [modal, setModal] = useState(null);

  const save = async ({ zone_ids: zoneIds, ...values }) => {
    await rpc('save_package', { p_id: modal.pkg?.id ?? null, p_package: values, p_zone_ids: zoneIds });
    state.reload();
  };

  const remove = async (pkg) => {
    if (!window.confirm(`ลบแพ็กเกจ ${pkg.name}?`)) return;
    await run(() => unwrap(supabase.from('packages').delete().eq('id', pkg.id).select()), 'ลบแพ็กเกจแล้ว');
    state.reload();
  };

  return (
    <>
      <PageHeader title="แพ็กเกจและสิทธิ์การใช้งาน">
        <button className="btn btn-primary" disabled={!state.data} onClick={() => setModal({})}>เพิ่มแพ็กเกจ</button>
      </PageHeader>

      <Async state={state} empty="ยังไม่มีแพ็กเกจ" isEmpty={(d) => d.packages.length === 0}>
        {({ packages, zones }) => (
          <div className="package-grid">
            {packages.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} zones={zones}
                onEdit={() => setModal({ pkg })} onRemove={() => remove(pkg)} />
            ))}
          </div>
        )}
      </Async>

      {modal && (
        <FormModal
          title={modal.pkg ? 'แก้ไขแพ็กเกจ' : 'เพิ่มแพ็กเกจ'}
          fields={packageFields(state.data.zones)}
          initial={modal.pkg && {
            ...modal.pkg,
            access_start: modal.pkg.access_start?.slice(0, 5),
            access_end: modal.pkg.access_end?.slice(0, 5),
            zone_ids: modal.pkg.package_zones.map((pz) => pz.zone_id),
          }}
          onSubmit={save}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
