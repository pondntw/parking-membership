const TIME_ZONE = 'Asia/Bangkok';

export const VEHICLE_TYPES = { car: 'รถยนต์', motorcycle: 'รถจักรยานยนต์' };
export const PAYMENT_METHODS = { cash: 'เงินสด', transfer: 'โอนเงิน', card: 'บัตร' };
export const PAYMENT_KINDS = { subscription: 'ค่าสมาชิก', overage: 'ค่าจอดส่วนเกิน' };
export const SUBSCRIPTION_KINDS = { new: 'สมัครใหม่', renewal: 'ต่ออายุ' };

export const MEMBER_STATUS = {
  active: { label: 'ใช้งาน', tone: 'good' },
  suspended: { label: 'ระงับ', tone: 'bad' },
};

export const TERM_STATE = {
  active: { label: 'ใช้งานอยู่', tone: 'good' },
  upcoming: { label: 'รอเริ่มรอบ', tone: 'info' },
  pending: { label: 'รอชำระ', tone: 'warn' },
  expired: { label: 'หมดอายุ', tone: 'neutral' },
  cancelled: { label: 'ยกเลิก', tone: 'neutral' },
};

export const PAYMENT_STATUS = {
  pending: { label: 'รอชำระ', tone: 'warn' },
  paid: { label: 'ชำระแล้ว', tone: 'good' },
  void: { label: 'ยกเลิก', tone: 'neutral' },
};

export const SPOT_STATUS = {
  available: { label: 'ว่าง', tone: 'good' },
  occupied: { label: 'มีรถจอด', tone: 'bad' },
  out_of_service: { label: 'ปิดใช้งาน', tone: 'neutral' },
};

export const money = (value) =>
  Number(value ?? 0).toLocaleString('th-TH', { style: 'currency', currency: 'THB' });

export const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString('th-TH', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })
    : '–';

export const date = (value) =>
  value
    ? new Date(`${value}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: TIME_ZONE, dateStyle: 'medium' })
    : '–';

export function duration(minutes) {
  if (minutes == null) return '–';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} นาที`;
  return rest ? `${hours} ชม. ${rest} นาที` : `${hours} ชม.`;
}

export const minutesSince = (value) => Math.max(0, Math.ceil((Date.now() - new Date(value)) / 60000));

export const accessHours = (pkg) =>
  pkg.access_start ? `${pkg.access_start.slice(0, 5)}–${pkg.access_end.slice(0, 5)} น.` : 'ตลอดวัน';

export const quotaLabel = (hours) => (hours == null ? 'ไม่จำกัด' : `${hours} ชม.`);
