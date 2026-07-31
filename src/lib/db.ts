import { createClient } from '@supabase/supabase-js';

// ==========================================
// Project 1 (Primary Supabase Client)
// ==========================================
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey || !supabaseUrl.startsWith('http')) {
  console.warn('⚠️ [DB] Primary Supabase URL and Anon Key are missing or invalid. Please check your .env file.');
}

const validUrl = supabaseUrl.startsWith('http') ? supabaseUrl : 'https://placeholder.supabase.co';

const timeoutFetch = (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
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

if (process.env.NODE_ENV !== 'test') {
  console.log(`⚡ [DB] Primary Supabase initialized: ${validUrl}`);
}

// ==========================================
// Project 2 (Secondary Supabase Client)
// ==========================================
const supabase2Url = process.env.NEXT_PUBLIC_SUPABASE_2_URL || process.env.SUPABASE_2_URL || '';
const supabase2AnonKey = process.env.NEXT_PUBLIC_SUPABASE_2_ANON_KEY || process.env.SUPABASE_2_ANON_KEY || '';
const supabase2ServiceKey = process.env.SUPABASE_2_SERVICE_ROLE_KEY || '';

const validUrl2 = supabase2Url.startsWith('http') ? supabase2Url : validUrl;

if (process.env.NODE_ENV !== 'test' && supabase2Url) {
  console.log(`⚡ [DB] Secondary Supabase initialized: ${validUrl2}`);
}

export const supabase2 = createClient(validUrl2, supabase2ServiceKey || supabase2AnonKey || supabaseAnonKey || 'placeholder', {
  auth: {
    storageKey: 'sb-secondary-auth-token',
  },
  global: {
    fetch: timeoutFetch,
  },
});

export const supabase2Server = createClient(validUrl2, supabase2ServiceKey || supabase2AnonKey || supabaseAnonKey || 'placeholder', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: timeoutFetch,
  },
});
