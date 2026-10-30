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

export async function registerAccount(details) {
  // A separate, nonpersistent client prevents signup from logging in the main app.
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'badminton-registration' } });
  const result = await client.auth.signUp(details);
  if (result.data?.session) await client.auth.signOut({ scope: 'local' });
  return result;
}
