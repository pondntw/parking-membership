import { useEffect, useRef, useState } from 'react';

export function Modal({ title, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current.open) ref.current.showModal();
  }, []);

  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" aria-label="ปิด" onClick={onClose}>×</button>
      </div>
      {children}
    </dialog>
  );
}

const blankFor = (field) => {
  if (field.type === 'checkbox') return false;
  if (field.type === 'checkgroup') return [];
  return '';
};

const cleanValue = (field, value) => {
  if (field.type === 'checkbox' || field.type === 'checkgroup') return value;
  if (value === '') return null;
  return field.type === 'number' ? Number(value) : value;
};

function Input({ field, value, onChange }) {
  const { name, type = 'text', options = [] } = field;

  if (type === 'select') {
    return (
      <select id={name} required={field.required} value={value} onChange={(e) => onChange(e.target.value)}>
        {field.placeholder && <option value="">{field.placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  if (type === 'textarea') {
    return <textarea id={name} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <input id={name} type={type} required={field.required} value={value} min={field.min} step={field.step}
      pattern={field.pattern} title={field.title} placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)} />
  );
}

export function FormModal({ title, fields, initial = {}, submitLabel = 'บันทึก', onSubmit, onClose }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? f.default ?? blankFor(f)])));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (name, value) => setValues((prev) => ({ ...prev, [name]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(Object.fromEntries(fields.map((f) => [f.name, cleanValue(f, values[f.name])])));
      onClose();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <p className="form-error" role="alert">{error}</p>}
        {fields.map((field) => {
          if (field.type === 'checkbox') {
            return (
              <label key={field.name} className="check">
                <input type="checkbox" checked={values[field.name]}
                  onChange={(e) => set(field.name, e.target.checked)} />
                {field.label}
              </label>
            );
          }
          if (field.type === 'checkgroup') {
            return (
              <fieldset key={field.name} className="field">
                <legend>{field.label}</legend>
                {field.options.map((option) => (
                  <label key={option.value} className="check">
                    <input type="checkbox" checked={values[field.name].includes(option.value)}
                      onChange={(e) => set(field.name, e.target.checked
                        ? [...values[field.name], option.value]
                        : values[field.name].filter((v) => v !== option.value))} />
                    {option.label}
                  </label>
                ))}
                {field.hint && <small className="muted">{field.hint}</small>}
              </fieldset>
            );
          }
          return (
            <div key={field.name} className="field">
              <label htmlFor={field.name}>{field.label}</label>
              <Input field={field} value={values[field.name]} onChange={(v) => set(field.name, v)} />
              {field.hint && <small className="muted">{field.hint}</small>}
            </div>
          );
        })}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'กำลังบันทึก…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
