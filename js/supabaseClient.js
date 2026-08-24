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

  // Configuration resolution:
  // 1. window.ERLANGLY_CONFIG (loaded from git-ignored js/config.js)
  // 2. localStorage override ('erlangly_supabase_url', 'erlangly_supabase_anon_key')
  // 3. Fallback demo sandbox
  var envConfig = (root.ERLANGLY_CONFIG || {});
  var SUPABASE_URL = envConfig.SUPABASE_URL || localStorage.getItem('erlangly_supabase_url') || 'https://demo.supabase.co';
  var SUPABASE_ANON_KEY = envConfig.SUPABASE_ANON_KEY || localStorage.getItem('erlangly_supabase_anon_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMH0.demo';

  var client = null;
  var isDemoMode = SUPABASE_URL === 'https://demo.supabase.co' || !SUPABASE_URL;

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
      var storageKey = 'erlangly_mock_' + table;
      var getRecords = function() {
        return JSON.parse(localStorage.getItem(storageKey) || '[]');
      };
      var setRecords = function(recs) {
        localStorage.setItem(storageKey, JSON.stringify(recs));
      };

      var queryBuilder = {
        _filters: [],
        _orderField: null,
        _orderOpts: null,

        select: function(cols) {
          return this;
        },

        eq: function(field, val) {
          this._filters.push(function(row) {
            return row[field] === val;
          });
          return this;
        },

        in: function(field, valArray) {
          this._filters.push(function(row) {
            return Array.isArray(valArray) && valArray.indexOf(row[field]) !== -1;
          });
          return this;
        },

        order: function(field, opts) {
          this._orderField = field;
          this._orderOpts = opts || { ascending: true };
          return this;
        },

        then: function(onFulfilled, onRejected) {
          var items = getRecords();
          for (var i = 0; i < this._filters.length; i++) {
            items = items.filter(this._filters[i]);
          }
          if (this._orderField) {
            var f = this._orderField;
            var asc = this._orderOpts && this._orderOpts.ascending !== false;
            items.sort(function(a, b) {
              if (a[f] < b[f]) return asc ? -1 : 1;
              if (a[f] > b[f]) return asc ? 1 : -1;
              return 0;
            });
          }
          return Promise.resolve({ data: items, error: null }).then(onFulfilled, onRejected);
        },

        insert: function(rows) {
          var items = getRecords();
          var inserted = (rows || []).map(function(r) {
            var item = Object.assign({}, r, {
              id: r.id || ('rec_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)),
              created_at: r.created_at || new Date().toISOString()
            });
            if (table === 'plans') {
              item.updated_at = item.updated_at || item.created_at;
            }
            items.unshift(item);
            return item;
          });
          setRecords(items);
          var res = { data: inserted, error: null };
          return {
            select: function() {
              return Promise.resolve(res);
            },
            then: function(onFulfilled, onRejected) {
              return Promise.resolve(res).then(onFulfilled, onRejected);
            }
          };
        },

        update: function(updates) {
          var self = this;
          return {
            eq: function(field, val) {
              var items = getRecords();
              var updatedItems = [];
              items = items.map(function(row) {
                if (row[field] === val) {
                  var updated = Object.assign({}, row, updates);
                  if (table === 'plans') {
                    updated.updated_at = new Date().toISOString();
                  }
                  updatedItems.push(updated);
                  return updated;
                }
                return row;
              });
              setRecords(items);
              var res = { data: updatedItems, error: null };
              return {
                select: function() {
                  return Promise.resolve(res);
                },
                then: function(onFulfilled, onRejected) {
                  return Promise.resolve(res).then(onFulfilled, onRejected);
                }
              };
            }
          };
        },

        delete: function() {
          return {
            eq: function(field, val) {
              var items = getRecords();
              var remaining = items.filter(function(row) { return row[field] !== val; });
              setRecords(remaining);
              return Promise.resolve({ data: [], error: null });
            }
          };
        }
      };

      return queryBuilder;
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = client || mockClient;
  }
  root.ErlanglySupabase = client || mockClient;

  root.ErlanglySupabaseConfig = {
    setCredentials: function(url, anonKey) {
      if (url) localStorage.setItem('erlangly_supabase_url', url.trim());
      if (anonKey) localStorage.setItem('erlangly_supabase_anon_key', anonKey.trim());
      if (typeof window !== 'undefined') window.location.reload();
    },
    clearCredentials: function() {
      localStorage.removeItem('erlangly_supabase_url');
      localStorage.removeItem('erlangly_supabase_anon_key');
      if (typeof window !== 'undefined') window.location.reload();
    },
    getCredentials: function() {
      return {
        url: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        isConfigured: !isDemoMode
      };
    }
  };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
