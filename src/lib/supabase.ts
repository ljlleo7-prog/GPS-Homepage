import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: {
      getItem: (key) => {
        const name = key + "=";
        const decodedCookie = decodeURIComponent(document.cookie);
        const ca = decodedCookie.split(';');
        for (let i = 0; i < ca.length; i++) {
          let c = ca[i];
          while (c.charAt(0) === ' ') {
            c = c.substring(1);
          }
          if (c.indexOf(name) === 0) {
            return c.substring(name.length, c.length);
          }
        }
        return null;
      },
      setItem: (key, value) => {
        const isProd = window.location.hostname.endsWith('geeksproductionstudio.com');
        const domain = isProd ? '.geeksproductionstudio.com' : window.location.hostname;
        const maxAge = 60 * 60 * 24 * 365; // 1 year
        document.cookie = `${key}=${encodeURIComponent(value)}; domain=${domain}; path=/; max-age=${maxAge}; SameSite=Lax; Secure`;
      },
      removeItem: (key) => {
        const isProd = window.location.hostname.endsWith('geeksproductionstudio.com');
        const domain = isProd ? '.geeksproductionstudio.com' : window.location.hostname;
        document.cookie = `${key}=; domain=${domain}; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax; Secure`;
      },
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
