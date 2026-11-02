import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FormModal } from '../components/FormModal.jsx';
import { Async, Badge, PageHeader, TableNote } from '../components/ui.jsx';
import { LIST_LIMIT, searchTerm, unwrap, unwrapList } from '../lib/data.js';
import { date, MEMBER_STATUS } from '../lib/format.js';
import { useData, useDebounced } from '../lib/hooks.js';
import { supabase } from '../lib/supabase.js';

export const memberFields = [
  { name: 'full_name', label: 'ชื่อ–นามสกุล', required: true },
  {
    name: 'phone',
    label: 'เบอร์โทรศัพท์',
    type: 'tel',
    required: true,
    pattern: '0[0-9]{8,9}',
    title: 'ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0',
  },
  { name: 'email', label: 'อีเมล', type: 'email' },
  { name: 'address', label: 'ที่อยู่', type: 'textarea' },
];

const listMembers = (text) => {
  const term = searchTerm(text);
  let query = supabase.from('member_overview').select('*', { count: 'exact' })
    .order('id', { ascending: false }).limit(LIST_LIMIT);
  if (term) query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,code.ilike.%${term}%`);
  return unwrapList(query);
};

export default function Members() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const term = useDebounced(search);
  const state = useData(() => listMembers(term), [term]);

  const create = async (values) => {
    const row = await unwrap(supabase.from('members').insert(values).select().single());
    navigate(`/members/${row.id}`);
  };

  return (
    <>
      <PageHeader title="สมาชิก">
        <button className="btn btn-primary" onClick={() => setAdding(true)}>เพิ่มสมาชิก</button>
      </PageHeader>

      <input className="search" type="search" aria-label="ค้นหาสมาชิก" placeholder="ค้นหาชื่อ เบอร์โทร หรือรหัสสมาชิก"
        value={search} onChange={(e) => setSearch(e.target.value)} />

      <Async state={state} empty="ไม่พบสมาชิก" isEmpty={(d) => d.rows.length === 0}>
        {({ rows, total }) => (
          <div className="card table-card">
            <table>
              <thead>
                <tr><th>รหัส</th><th>ชื่อ</th><th>เบอร์โทร</th><th>รถ</th><th>สมาชิกถึง</th><th>สถานะ</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>{m.code}</td>
                    <td><Link to={`/members/${m.id}`}>{m.full_name}</Link></td>
                    <td>{m.phone}</td>
                    <td>{m.vehicle_count} คัน</td>
                    <td>{date(m.paid_until)}</td>
                    <td><Badge status={MEMBER_STATUS[m.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TableNote shown={rows.length} total={total} />
          </div>
        )}
      </Async>

      {adding && (
        <FormModal title="เพิ่มสมาชิก" fields={memberFields} onSubmit={create} onClose={() => setAdding(false)} />
      )}
    </>
  );
}
