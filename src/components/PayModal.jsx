import { rpc } from '../lib/data.js';
import { money, PAYMENT_METHODS } from '../lib/format.js';
import { FormModal } from './FormModal.jsx';
import { useToast } from './Toast.jsx';

const FIELDS = [
  {
    name: 'method',
    label: 'วิธีชำระเงิน',
    type: 'select',
    required: true,
    default: 'cash',
    options: Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })),
  },
  { name: 'reference', label: 'เลขอ้างอิง (ถ้ามี)' },
];

export default function PayModal({ paymentId, amount, onClose, onDone }) {
  const toast = useToast();

  const submit = async ({ method, reference }) => {
    await rpc('record_payment', { p_payment_id: paymentId, p_method: method, p_reference: reference });
    toast('บันทึกการรับชำระแล้ว');
    onDone();
  };

  return (
    <FormModal
      title={`รับชำระ ${money(amount)}`}
      fields={FIELDS}
      submitLabel="บันทึกการรับเงิน"
      onSubmit={submit}
      onClose={onClose}
    />
  );
}
