import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);
export const supabase: SupabaseClient = configured
  ? createClient(url!, key!)
  : (null as unknown as SupabaseClient);

export const errMsg = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e ? String((e as any).message) : String(e);
