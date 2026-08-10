import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey || !supabaseUrl.startsWith('http')) {
  console.warn('Supabase URL and Anon Key are missing or invalid. Please add them to your .env file.');
}

const validUrl = supabaseUrl.startsWith('http') ? supabaseUrl : 'https://placeholder.supabase.co';

// Portal roster + test-results loads can exceed 15s on Vercel cold starts.
// Aborting early left allTestResults empty and every employee looked "Not Started".
const SUPABASE_FETCH_TIMEOUT_MS = 45_000;

const timeoutFetch = (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
  return fetch(url, {
    ...options,
    signal: controller.signal,
  } as RequestInit).finally(() => clearTimeout(timeoutId));
};

export const supabase = createClient(validUrl, supabaseServiceKey || supabaseAnonKey || 'placeholder', {
  global: {
    fetch: timeoutFetch,
  },
});

// Use anon key as fallback if service key is missing (will have limited permissions)
export const supabaseServer = createClient(validUrl, supabaseServiceKey || supabaseAnonKey || 'placeholder', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: timeoutFetch,
  },
});

if (!supabaseServiceKey) {
  console.warn('⚠️ [DB] SUPABASE_SERVICE_ROLE_KEY not set. Using anon key for server operations (storage uploads may fail). Get the service key from Supabase project settings.');
}