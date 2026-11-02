import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRun, useToast } from '../components/Toast.jsx';
import { Async, Badge, PageHeader } from '../components/ui.jsx';
import { rpc, unwrap } from '../lib/data.js';
import {
  dateTime, date, duration, MEMBER_STATUS, minutesSince, money, PAYMENT_METHODS, quotaLabel, VEHICLE_TYPES,
} from '../lib/format.js';
import { useData } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';

function CheckIn({ status, onDone }) {
  const run = useRun();
  const toast = useToast();
  const [spotId, setSpotId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const visit = await run(() => rpc('check_in', {
      p_vehicle_id: status.vehicle.id,
      p_spot_id: spotId ? Number(spotId) : null,
    }));
    setBusy(false);
    if (!visit) return;
    toast(`บันทึกรถเข้าแล้ว ช่องจอด ${visit.spot_label}`);
    if (Number(visit.outstanding) > 0) {
      toast(`สมาชิกมีค่าจอดค้างชำระ ${money(visit.outstanding)}`, 'warning');
    }
    onDone();
  };

  return (
    <form onSubmit={submit} className="gate-action">
      <div className="field">
        <label htmlFor="spot">ช่องจอด</label>
        <select id="spot" value={spotId} onChange={(e) => setSpotId(e.target.value)}>
          <option value="">ให้ระบบเลือก ({status.spots[0].zone_name} / {status.spots[0].code})</option>
          {status.spots.map((spot) => (
            <option key={spot.id} value={spot.id}>{spot.zone_name} / {spot.code}</option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary btn-large" disabled={busy}>บันทึกรถเข้า</button>
    </form>
  );
}

function CheckOut({ status, onDone }) {
  const run = useRun();
  const toast = useToast();
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const { open_visit: visit, preview } = status;
  const hasFee = Number(preview.fee) > 0;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const done = await run(() => rpc('check_out', {
      p_visit_id: visit.id,
      p_method: hasFee && method ? method : null,
      p_reference: reference || null,
    }));
    setBusy(false);
    if (!done) return;
    const fee = Number(done.fee);
    if (fee === 0) toast('บันทึกรถออกแล้ว ไม่มีค่าบริการเพิ่ม');
    else if (done.payment_status === 'paid') toast(`บันทึกรถออกและรับชำระ ${money(fee)} แล้ว`);
    else toast(`บันทึกรถออกแล้ว ค้างชำระ ${money(fee)}`, 'warning');
    onDone();
  };

  return (
    <form onSubmit={submit} className="gate-action">
      <dl className="facts">
        <div><dt>เข้าเมื่อ</dt><dd>{dateTime(visit.entry_time)}</dd></div>
        <div><dt>ช่องจอด</dt><dd>{visit.spot_label}</dd></div>
        <div><dt>ระยะเวลา</dt><dd>{duration(preview.total_min)}</dd></div>
        <div><dt>เวลาที่คิดเงิน</dt><dd>{duration(preview.chargeable_min)}</dd></div>
      </dl>
      <div className="fee-total">
        <span>ค่าบริการ</span>
        <strong>{money(preview.fee)}</strong>
      </div>
      {hasFee && (
        <>
          <div className="field">
            <label htmlFor="pay-method">การชำระเงิน</label>
            <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
              <option value="">ค้างชำระ</option>
            </select>
          </div>
          {method && method !== 'cash' && (
            <div className="field">
              <label htmlFor="pay-reference">เลขอ้างอิง</label>
              <input id="pay-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}
        </>
      )}
      <button className="btn btn-primary btn-large" disabled={busy}>บันทึกรถออก</button>
    </form>
  );
}

function VehicleCard({ status, onDone }) {
  const { vehicle, member, term, package: pkg, denial, open_visit: openVisit } = status;

  return (
    <article className="card gate-card">
      <header>
        <div className="plate">{vehicle.plate}</div>
        <div className="muted">{vehicle.province} · {VEHICLE_TYPES[vehicle.type]}</div>
      </header>

      <dl className="facts">
        <div>
          <dt>สมาชิก</dt>
          <dd><Link to={`/members/${member.id}`}>{member.full_name}</Link> <Badge status={MEMBER_STATUS[member.status]} /></dd>
        </div>
        <div><dt>แพ็กเกจ</dt><dd>{pkg?.name ?? 'ไม่มี'}</dd></div>
        {term && <div><dt>หมดอายุ</dt><dd>{date(term.end_date)}</dd></div>}
        {term && (
          <div>
            <dt>ใช้ไปแล้ว</dt>
            <dd>{duration(status.used_minutes)} / {quotaLabel(term.included_hours)}</dd>
          </div>
        )}
      </dl>

      {Number(status.outstanding) > 0 && (
        <p className="notice notice-warn">มีค่าจอดค้างชำระ {money(status.outstanding)}</p>
      )}

      {openVisit && <CheckOut status={status} onDone={onDone} />}
      {!openVisit && denial && <p className="notice notice-bad" role="alert">เข้าไม่ได้: {denial}</p>}
      {!openVisit && !denial && <CheckIn status={status} onDone={onDone} />}
    </article>
  );
}

function ParkedList({ state, onPick }) {
  return (
    <section className="card">
      <h2>รถในลานตอนนี้</h2>
      <Async state={state} empty="ไม่มีรถในลาน" isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <ul className="parked-list">
            {rows.map((row) => (
              <li key={row.id}>
                <button onClick={() => onPick(row.plate)}>
                  <span className="plate plate-small">{row.plate}</span>
                  <span className="muted">{row.zone_name} / {row.spot_code}</span>
                  <span>{duration(minutesSince(row.entry_time))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </section>
  );
}

export default function Gate() {
  const run = useRun();
  const [plate, setPlate] = useState('');
  const [results, setResults] = useState(null);
  const parked = useData(
    () => unwrap(supabase.from('visit_history').select('id, plate, province, zone_name, spot_code, entry_time')
      .is('exit_time', null).order('entry_time', { ascending: false })),
    [],
    { refreshMs: 15000 },
  );

  const search = async (text) => {
    if (!text.trim()) return;
    const found = await run(() => rpc('gate_lookup', { p_plate: text }));
    if (found) setResults(found);
  };

  const finish = () => {
    setPlate('');
    setResults(null);
    parked.reload();
  };

  return (
    <>
      <PageHeader title="บันทึกเข้า–ออก" />
      <div className="two-col two-col-wide-left">
        <div>
          <form className="plate-search" onSubmit={(e) => { e.preventDefault(); search(plate); }}>
            <label htmlFor="plate" className="sr-only">ทะเบียนรถ</label>
            <input id="plate" autoFocus autoComplete="off" placeholder="พิมพ์ทะเบียนรถ เช่น 1กข1111"
              value={plate} onChange={(e) => setPlate(e.target.value)} />
            <button className="btn btn-primary">ค้นหา</button>
          </form>

          {results?.length === 0 && (
            <p className="notice notice-warn">ไม่พบทะเบียนนี้ในระบบ ระบบนี้รับเฉพาะรถของสมาชิกที่ลงทะเบียนแล้ว</p>
          )}
          {results?.map((status) => (
            <VehicleCard key={status.vehicle.id} status={status} onDone={finish} />
          ))}
        </div>
        <ParkedList state={parked} onPick={(text) => { setPlate(text); search(text); }} />
      </div>
    </>
  );
}
