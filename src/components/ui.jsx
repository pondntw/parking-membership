export const Loading = () => <p className="muted" role="status">กำลังโหลด…</p>;

export const Badge = ({ status }) => (
  <span className={`badge badge-${status?.tone ?? 'neutral'}`}>{status?.label ?? '–'}</span>
);

export function PageHeader({ title, children }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

// Shows the error, spinner or empty state so that `children` only renders with data.
export function Async({ state, empty, isEmpty, children }) {
  if (state.error && !state.data) return <p className="form-error" role="alert">{state.error.message}</p>;
  if (!state.data) return <Loading />;
  if (isEmpty?.(state.data)) return <p className="empty">{empty}</p>;
  return children(state.data);
}

export function TableNote({ shown, total }) {
  if (total <= shown) return null;
  return <p className="muted table-note">แสดง {shown.toLocaleString()} จาก {total.toLocaleString()} รายการ กรุณาค้นหาให้แคบลง</p>;
}
