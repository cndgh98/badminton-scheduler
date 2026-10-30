import { createClient } from '@supabase/supabase-js';
const url = process.env.REACT_APP_SUPABASE_URL;
const key = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
export const backend = url && key ? createClient(url, key) : null;
export function loginEmail(username) {
  return `${username.trim().toLowerCase()}@members.invalid`;
}
export function koreaDate(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}
