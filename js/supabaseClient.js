/**
 * Erlangly Supabase Client Init (js/supabaseClient.js)
 * 
 * Rules from AGENTS.md:
 * - Only the anon/public key ever ships client-side
 * - Service role key must NEVER appear in this repo
 * - Provides seamless local fallback sandbox if credentials are not yet configured
 */

(function(root) {
  'use strict';

  // Public Supabase Configuration
  // Users can override via localStorage or environment config
  var SUPABASE_URL = localStorage.getItem('erlangly_supabase_url') || 'https://demo.supabase.co';
  var SUPABASE_ANON_KEY = localStorage.getItem('erlangly_supabase_anon_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMH0.demo';

  var client = null;
  var isDemoMode = SUPABASE_URL === 'https://demo.supabase.co';

  if (typeof root.supabase !== 'undefined' && root.supabase.createClient && !isDemoMode) {
    try {
      client = root.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn('Supabase client initialization fallback:', e);
      client = null;
    }
  }

  // Fallback Local Sandbox Client (for offline/demo when live Supabase is not attached)
  var mockClient = {
    isMock: true,
    auth: {
      getUser: function() {
        var user = JSON.parse(localStorage.getItem('erlangly_mock_user') || 'null');
        return Promise.resolve({ data: { user: user }, error: null });
      },
      getSession: function() {
        var user = JSON.parse(localStorage.getItem('erlangly_mock_user') || 'null');
        return Promise.resolve({
          data: { session: user ? { user: user, access_token: 'demo-token' } : null },
          error: null
        });
      },
      signUp: function(creds) {
        var user = {
          id: 'usr_' + Date.now().toString(36),
          email: creds.email,
          created_at: new Date().toISOString()
        };
        localStorage.setItem('erlangly_mock_user', JSON.stringify(user));
        return Promise.resolve({ data: { user: user, session: { user: user } }, error: null });
      },
      signInWithPassword: function(creds) {
        var user = {
          id: 'usr_demo_active',
          email: creds.email,
          created_at: new Date().toISOString()
        };
        localStorage.setItem('erlangly_mock_user', JSON.stringify(user));
        return Promise.resolve({ data: { user: user, session: { user: user } }, error: null });
      },
      signInWithOtp: function(creds) {
        var user = {
          id: 'usr_otp_active',
          email: creds.email,
          created_at: new Date().toISOString()
        };
        localStorage.setItem('erlangly_mock_user', JSON.stringify(user));
        return Promise.resolve({ data: { user: user, session: { user: user } }, error: null });
      },
      signOut: function() {
        localStorage.removeItem('erlangly_mock_user');
        return Promise.resolve({ error: null });
      },
      onAuthStateChange: function(callback) {
        // Simple mock subscriber
        return {
          data: {
            subscription: {
              unsubscribe: function() {}
            }
          }
        };
      }
    },
    from: function(table) {
      return {
        select: function(cols) {
          return {
            eq: function(field, val) {
              return {
                order: function(orderField, opts) {
                  var plans = JSON.parse(localStorage.getItem('erlangly_mock_plans') || '[]');
                  var filtered = plans.filter(function(p) { return p[field] === val; });
                  return Promise.resolve({ data: filtered, error: null });
                }
              };
            },
            order: function(orderField, opts) {
              var plans = JSON.parse(localStorage.getItem('erlangly_mock_plans') || '[]');
              return Promise.resolve({ data: plans, error: null });
            }
          };
        },
        insert: function(rows) {
          var plans = JSON.parse(localStorage.getItem('erlangly_mock_plans') || '[]');
          var inserted = rows.map(function(r) {
            var item = Object.assign({}, r, {
              id: 'pln_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
            plans.unshift(item);
            return item;
          });
          localStorage.setItem('erlangly_mock_plans', JSON.stringify(plans));
          return Promise.resolve({ data: inserted, error: null });
        },
        update: function(updates) {
          return {
            eq: function(field, val) {
              var plans = JSON.parse(localStorage.getItem('erlangly_mock_plans') || '[]');
              var updatedItem = null;
              plans = plans.map(function(p) {
                if (p[field] === val) {
                  updatedItem = Object.assign({}, p, updates, { updated_at: new Date().toISOString() });
                  return updatedItem;
                }
                return p;
              });
              localStorage.setItem('erlangly_mock_plans', JSON.stringify(plans));
              return Promise.resolve({ data: updatedItem ? [updatedItem] : [], error: null });
            }
          };
        },
        delete: function() {
          return {
            eq: function(field, val) {
              var plans = JSON.parse(localStorage.getItem('erlangly_mock_plans') || '[]');
              plans = plans.filter(function(p) { return p[field] !== val; });
              localStorage.setItem('erlangly_mock_plans', JSON.stringify(plans));
              return Promise.resolve({ data: [], error: null });
            }
          };
        }
      };
    }
  };

  root.ErlanglySupabase = client || mockClient;

})(typeof self !== 'undefined' ? self : this);
