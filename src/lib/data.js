import { supabase } from './supabase.js';

export const LIST_LIMIT = 200;

function thaiMessage(error) {
  if (error.code === 'P0001') return error.message;
  if (error.code === '23505') return 'ข้อมูลนี้มีอยู่แล้วในระบบ';
  if (error.code === '23503') return 'ลบไม่ได้ เพราะมีประวัติการใช้งานที่เกี่ยวข้อง';
  if (error.code === '23514') return 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  if (error.code === '42501') return 'ไม่มีสิทธิ์ทำรายการนี้';
  if (!error.code) return 'เชื่อมต่อฐานข้อมูลไม่ได้ กรุณาลองใหม่';
  return `เกิดข้อผิดพลาด: ${error.message}`;
}

export async function unwrap(query) {
  const { data, error } = await query;
  if (error) throw new Error(thaiMessage(error));
  return data;
}

// For lists capped at LIST_LIMIT, so the page can say when rows were left out.
export async function unwrapList(query) {
  const { data, error, count } = await query;
  if (error) throw new Error(thaiMessage(error));
  return { rows: data, total: count ?? data.length };
}

export const rpc = (name, args) => unwrap(supabase.rpc(name, args));

// Search text goes inside a PostgREST or() filter, where these characters are syntax.
export const searchTerm = (text) => text.replace(/[,()"\\%*]/g, ' ').trim();
export const plateTerm = (text) => searchTerm(text).replace(/[\s-]/g, '');

const nextDay = (date) => {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
};

export function withinDates(query, column, from, to) {
  let filtered = query;
  if (from) filtered = filtered.gte(column, `${from}T00:00:00+07:00`);
  if (to) filtered = filtered.lt(column, `${nextDay(to)}T00:00:00+07:00`);
  return filtered;
}
