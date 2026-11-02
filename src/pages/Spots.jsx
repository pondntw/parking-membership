import { useState } from 'react';
import { FormModal, Modal } from '../components/FormModal.jsx';
import { useRun } from '../components/Toast.jsx';
import { Async, Badge, PageHeader } from '../components/ui.jsx';
import { unwrap } from '../lib/data.js';
import { dateTime, duration, minutesSince, SPOT_STATUS, VEHICLE_TYPES } from '../lib/format.js';
import { useData } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';

const zoneFields = [
  { name: 'name', label: 'ชื่อโซน', required: true },
  {
    name: 'vehicle_type',
    label: 'ประเภทรถ',
    type: 'select',
    required: true,
    default: 'car',
    options: Object.entries(VEHICLE_TYPES).map(([value, label]) => ({ value, label })),
  },
  { name: 'description', label: 'รายละเอียด', type: 'textarea' },
];

const bulkFields = [
  { name: 'prefix', label: 'คำนำหน้ารหัส', placeholder: 'เช่น A-' },
  { name: 'start', label: 'เริ่มจากเลข', type: 'number', min: 0, required: true, default: 1 },
  { name: 'count', label: 'จำนวนช่อง', type: 'number', min: 1, required: true, default: 10 },
];

const FILTERS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'available', label: 'ว่าง' },
  { value: 'occupied', label: 'มีรถจอด' },
  { value: 'out_of_service', label: 'ปิดใช้งาน' },
];

function SpotModal({ spot, onClose, onChanged }) {
  const run = useRun();

  const toggle = async () => {
    const result = await run(
      () => unwrap(supabase.from('spots').update({ out_of_service: !spot.out_of_service }).eq('id', spot.id).select()),
      spot.out_of_service ? 'เปิดใช้งานช่องจอดแล้ว' : 'ปิดใช้งานช่องจอดแล้ว',
    );
    if (result) { onChanged(); onClose(); }
  };

  const remove = async () => {
    if (!window.confirm(`ลบช่องจอด ${spot.code}?`)) return;
    const result = await run(
      () => unwrap(supabase.from('spots').delete().eq('id', spot.id).select()),
      'ลบช่องจอดแล้ว',
    );
    if (result) { onChanged(); onClose(); }
  };

  return (
    <Modal title={`ช่องจอด ${spot.code}`} onClose={onClose}>
      <p><Badge status={SPOT_STATUS[spot.status]} /> <span className="muted">{spot.zone_name}</span></p>
      {spot.status === 'occupied' && (
        <dl className="facts">
          <div><dt>ทะเบียน</dt><dd>{spot.plate} {spot.province}</dd></div>
          <div><dt>สมาชิก</dt><dd>{spot.member_name}</dd></div>
          <div><dt>เข้าเมื่อ</dt><dd>{dateTime(spot.entry_time)}</dd></div>
          <div><dt>จอดมาแล้ว</dt><dd>{duration(minutesSince(spot.entry_time))}</dd></div>
        </dl>
      )}
      {spot.status !== 'occupied' && (
        <div className="modal-actions">
          <button className="btn btn-danger" onClick={remove}>ลบช่องจอด</button>
          <button className="btn" onClick={toggle}>{spot.out_of_service ? 'เปิดใช้งาน' : 'ปิดใช้งาน (ซ่อมบำรุง)'}</button>
        </div>
      )}
    </Modal>
  );
}

function ZoneSection({ zone, spots, filter, onEdit, onAddSpots, onPick, onRemove }) {
  const shown = filter === 'all' ? spots : spots.filter((s) => s.status === filter);
  const available = spots.filter((s) => s.status === 'available').length;

  return (
    <section className="card">
      <header className="zone-head">
        <div>
          <h2>{zone.name}</h2>
          <span className="muted">{VEHICLE_TYPES[zone.vehicle_type]} · ว่าง {available}/{spots.length} ช่อง</span>
        </div>
        <div className="row-actions">
          <button className="btn btn-small" onClick={onAddSpots}>เพิ่มช่องจอด</button>
          <button className="btn btn-small" onClick={onEdit}>แก้ไข</button>
          <button className="btn btn-small btn-danger" onClick={onRemove}>ลบ</button>
        </div>
      </header>
      {shown.length === 0 ? (
        <p className="empty">{spots.length === 0 ? 'ยังไม่มีช่องจอดในโซนนี้' : 'ไม่มีช่องจอดตามตัวกรอง'}</p>
      ) : (
        <div className="spot-grid">
          {shown.map((spot) => (
            <button key={spot.id} className={`spot spot-${spot.status}`} onClick={() => onPick(spot)}>
              <span className="spot-code">{spot.code}</span>
              <span className="spot-state">{spot.plate ?? SPOT_STATUS[spot.status].label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const loadBoard = async () => {
  const [zones, spots] = await Promise.all([
    unwrap(supabase.from('zones').select('*').order('name')),
    unwrap(supabase.from('spot_status').select('*').order('code')),
  ]);
  return { zones, spots };
};

export default function Spots() {
  const run = useRun();
  const state = useData(loadBoard, [], { refreshMs: 15000 });
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);

  const saveZone = async (zone, id) => {
    await unwrap(id
      ? supabase.from('zones').update(zone).eq('id', id).select()
      : supabase.from('zones').insert(zone).select());
    state.reload();
  };

  const addSpots = async (zone, { prefix, start, count }) => {
    const rows = Array.from({ length: count }, (_, i) => ({
      zone_id: zone.id,
      code: `${prefix ?? ''}${String(start + i).padStart(2, '0')}`,
    }));
    await unwrap(supabase.from('spots').insert(rows).select());
    state.reload();
  };

  const removeZone = async (zone) => {
    if (!window.confirm(`ลบ${zone.name} และช่องจอดทั้งหมดในโซนนี้?`)) return;
    await run(() => unwrap(supabase.from('zones').delete().eq('id', zone.id).select()), 'ลบโซนแล้ว');
    state.reload();
  };

  return (
    <>
      <PageHeader title="สถานะช่องจอด">
        <button className="btn btn-primary" onClick={() => setModal({ type: 'zone' })}>เพิ่มโซน</button>
      </PageHeader>

      <div className="tabs" role="group" aria-label="กรองสถานะช่องจอด">
        {FILTERS.map((f) => (
          <button key={f.value} className={filter === f.value ? 'tab tab-active' : 'tab'}
            aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      <Async state={state} empty="ยังไม่มีโซน กด “เพิ่มโซน” เพื่อเริ่มต้น" isEmpty={(d) => d.zones.length === 0}>
        {({ zones, spots }) => zones.map((zone) => (
          <ZoneSection
            key={zone.id}
            zone={zone}
            spots={spots.filter((s) => s.zone_id === zone.id)}
            filter={filter}
            onEdit={() => setModal({ type: 'zone', zone })}
            onAddSpots={() => setModal({ type: 'spots', zone })}
            onPick={(spot) => setModal({ type: 'spot', spot })}
            onRemove={() => removeZone(zone)}
          />
        ))}
      </Async>

      {modal?.type === 'zone' && (
        <FormModal
          title={modal.zone ? 'แก้ไขโซน' : 'เพิ่มโซน'}
          fields={zoneFields}
          initial={modal.zone}
          onSubmit={(values) => saveZone(values, modal.zone?.id)}
          onClose={close}
        />
      )}
      {modal?.type === 'spots' && (
        <FormModal
          title={`เพิ่มช่องจอดใน${modal.zone.name}`}
          fields={bulkFields}
          submitLabel="เพิ่มช่องจอด"
          onSubmit={(values) => addSpots(modal.zone, values)}
          onClose={close}
        />
      )}
      {modal?.type === 'spot' && <SpotModal spot={modal.spot} onClose={close} onChanged={state.reload} />}
    </>
  );
}
