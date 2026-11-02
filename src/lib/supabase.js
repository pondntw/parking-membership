import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const mockMode = import.meta.env.VITE_DATA_MODE === 'mock';
export const configured = mockMode || Boolean(url && publishableKey);

// Each mock import sits behind this literal test so that a Supabase build drops
// the browser database, which is about 15 MB.
export const resetMockData = import.meta.env.VITE_DATA_MODE === 'mock'
  ? () => import('../mock/fetch.js').then((mock) => mock.resetMockData())
  : null;

function connect() {
  if (import.meta.env.VITE_DATA_MODE === 'mock') {
    const fetch = (...args) => import('../mock/fetch.js').then((mock) => mock.mockFetch(...args));
    return createClient('https://demo.invalid', 'demo', { global: { fetch } });
  }
  return configured ? createClient(url, publishableKey) : null;
}

export const supabase = connect();
