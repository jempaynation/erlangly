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
  // 1. localStorage override ('erlangly_supabase_url', 'erlangly_supabase_anon_key')
  // 2. window.ERLANGLY_CONFIG (loaded from js/config.js)
  // 3. Fallback demo sandbox
  var envConfig = (root.ERLANGLY_CONFIG || {});
  var localUrl = (typeof localStorage !== 'undefined' ? localStorage.getItem('erlangly_supabase_url') : null);
  var localKey = (typeof localStorage !== 'undefined' ? localStorage.getItem('erlangly_supabase_anon_key') : null);

  var rawUrl = (localUrl && localUrl.trim()) || (envConfig.SUPABASE_URL && envConfig.SUPABASE_URL.trim()) || '';
  var rawKey = (localKey && localKey.trim()) || (envConfig.SUPABASE_ANON_KEY && envConfig.SUPABASE_ANON_KEY.trim()) || '';

  var isPlaceholder = !rawUrl || rawUrl.indexOf('your-project-ref') !== -1 || rawUrl === 'https://demo.supabase.co';
  var isConfigured = !isPlaceholder && rawUrl.startsWith('http') && rawKey.length > 20;

  var SUPABASE_URL = isConfigured ? rawUrl : 'https://demo.supabase.co';
  var SUPABASE_ANON_KEY = isConfigured ? rawKey : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMH0.demo';

  var client = null;
  var isLive = false;

  if (typeof root.supabase !== 'undefined' && root.supabase.createClient && isConfigured) {
    try {
      client = root.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      isLive = true;
    } catch (e) {
      console.warn('Supabase live client initialization fallback:', e);
      client = null;
      isLive = false;
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
    setCredentials: function(url, anonKey, reload) {
      if (typeof localStorage !== 'undefined') {
        if (url) localStorage.setItem('erlangly_supabase_url', url.trim());
        if (anonKey) localStorage.setItem('erlangly_supabase_anon_key', anonKey.trim());
      }
      if (reload !== false && typeof window !== 'undefined') {
        window.location.reload();
      }
    },
    clearCredentials: function(reload) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('erlangly_supabase_url');
        localStorage.removeItem('erlangly_supabase_anon_key');
      }
      if (reload !== false && typeof window !== 'undefined') {
        window.location.reload();
      }
    },
    getCredentials: function() {
      return {
        url: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        isConfigured: isConfigured,
        isLive: isLive,
        source: (localUrl && localKey) ? 'localStorage' : (isConfigured ? 'config' : 'sandbox')
      };
    },
    getConnectionStatus: function() {
      var projectRef = '';
      if (isConfigured && SUPABASE_URL) {
        var match = SUPABASE_URL.match(/https?:\/\/([^.]+)\./);
        projectRef = match ? match[1] : SUPABASE_URL;
      }
      return {
        isLive: isLive,
        isConfigured: isConfigured,
        mode: isLive ? 'live' : 'mock',
        url: SUPABASE_URL,
        projectRef: projectRef,
        source: (localUrl && localKey) ? 'localStorage' : (isConfigured ? 'config' : 'sandbox')
      };
    },
    testConnection: function(testUrl, testKey) {
      var urlToTest = (typeof testUrl === 'string' ? testUrl : (SUPABASE_URL || '')).trim();
      var keyToTest = (typeof testKey === 'string' ? testKey : (SUPABASE_ANON_KEY || '')).trim();

      if (!urlToTest || !urlToTest.startsWith('http') || !keyToTest || urlToTest.indexOf('demo.supabase.co') !== -1 || keyToTest.indexOf('.demo') !== -1) {
        return Promise.resolve({
          success: false,
          error: 'Please enter a valid Supabase Project URL (e.g. https://xyz.supabase.co) and public anon key.'
        });
      }

      if (typeof root.supabase === 'undefined' || !root.supabase.createClient) {
        return Promise.resolve({
          success: false,
          error: 'Supabase JS library not loaded in this environment.'
        });
      }

      try {
        var tempClient = root.supabase.createClient(urlToTest, keyToTest);
        return tempClient.from('plans').select('id').limit(1).then(function(res) {
          if (res.error) {
            // Check for specific Supabase/PostgreSQL errors
            if (res.error.code === '42P01') {
              return {
                success: false,
                error: 'Connected to Supabase, but the "plans" table does not exist. Please run sql/schema.sql in the Supabase SQL Editor.'
              };
            }
            if (res.error.message && res.error.message.indexOf('infinite recursion') !== -1) {
              return {
                success: false,
                error: 'RLS Infinite recursion detected. Please update your SQL schema using the fixed sql/schema.sql.'
              };
            }
            return {
              success: false,
              error: 'Supabase query error: ' + (res.error.message || JSON.stringify(res.error))
            };
          }
          return {
            success: true,
            error: null,
            message: 'Successfully connected to live Supabase database!'
          };
        }).catch(function(err) {
          return {
            success: false,
            error: 'Connection failed: ' + (err.message || 'Check network / project URL')
          };
        });
      } catch (ex) {
        return Promise.resolve({
          success: false,
          error: 'Client init error: ' + ex.message
        });
      }
    }
  };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
