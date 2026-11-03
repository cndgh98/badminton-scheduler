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
  // GoTrue commits the new user before issuing the automatic password-grant token.
  // Our approval hook can reject that token even though registration succeeded.
  // Interpret only this specific signup-stage denial, never ordinary auth failures.
  if (result.error?.status === 403 && result.error.message?.includes('관리자 승인 대기 중')) {
    return { data: { user: null, session: null }, error: null, approvalPending: true };
  }
  if (result.data?.session) {
    try { await client.auth.signOut({ scope: 'local' }); } catch {
      // Cleanup of this nonpersistent client must not turn a committed signup into a failure.
    }
  }
  return result;
}
