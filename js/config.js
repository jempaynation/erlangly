/**
 * Erlangly Supabase Environment Configuration (js/config.js)
 * 
 * Rules from AGENTS.md:
 * - Only your Supabase Project URL and Public Anon Key ship client-side
 * - The Supabase Service Role Key must NEVER appear in this repo or client-side code
 * 
 * Instructions:
 * 1. You can paste your Supabase Project URL and Public Anon Key below, OR
 * 2. Set them directly in the browser via the "Supabase Connection Settings" UI on the Plans or Sign In page.
 * 3. Both methods persist credentials safely in your browser/deployment.
 */

window.ERLANGLY_CONFIG = {
  // Replace with your project URL, e.g. 'https://xyzcompany.supabase.co'
  SUPABASE_URL: '',
  // Replace with your project public anon key, e.g. 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  SUPABASE_ANON_KEY: ''
};
