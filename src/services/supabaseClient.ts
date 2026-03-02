
import { createClient } from '@supabase/supabase-js';

// NOTE: In a real scenario, these would come from process.env or import.meta.env
// Safely handling the case where import.meta.env might be undefined.
const env = (import.meta as any)?.env || {};

const supabaseUrl = env.VITE_SUPABASE_URL || 'https://xyz.supabase.co';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || 'public-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);