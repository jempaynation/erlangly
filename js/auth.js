/**
 * Erlangly Authentication Helpers (js/auth.js)
 * 
 * Rules from AGENTS.md:
 * - Client-side auth handling via Supabase Auth
 * - No login required to use core calculators
 * - Updates global navigation state (Sign In button vs. User Profile)
 */

(function(root) {
  'use strict';

  var ErlanglyAuth = {};

  ErlanglyAuth.getUser = function() {
    return root.ErlanglySupabase.auth.getUser().then(function(res) {
      return res.data ? res.data.user : null;
    }).catch(function() {
      return null;
    });
  };

  ErlanglyAuth.getSession = function() {
    return root.ErlanglySupabase.auth.getSession().then(function(res) {
      return res.data ? res.data.session : null;
    }).catch(function() {
      return null;
    });
  };

  ErlanglyAuth.signUp = function(email, password) {
    return root.ErlanglySupabase.auth.signUp({
      email: email,
      password: password
    });
  };

  ErlanglyAuth.signIn = function(email, password) {
    return root.ErlanglySupabase.auth.signInWithPassword({
      email: email,
      password: password
    });
  };

  ErlanglyAuth.signInWithMagicLink = function(email) {
    return root.ErlanglySupabase.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: window.location.origin + '/plans.html'
      }
    });
  };

  ErlanglyAuth.signOut = function() {
    return root.ErlanglySupabase.auth.signOut().then(function() {
      ErlanglyAuth.updateNavAuthUI();
      if (window.location.pathname.endsWith('plans.html')) {
        window.location.href = 'index.html';
      }
    });
  };

  /**
   * Update Global Navigation Bar with Auth State
   */
  ErlanglyAuth.updateNavAuthUI = function() {
    var authBtn = document.getElementById('nav-auth-btn');
    if (!authBtn) return;

    ErlanglyAuth.getUser().then(function(user) {
      if (user && user.email) {
        var shortName = user.email.split('@')[0];
        authBtn.textContent = '👤 ' + shortName;
        authBtn.href = 'plans.html';
        authBtn.className = 'btn btn-secondary btn-sm';
      } else {
        authBtn.textContent = 'Sign In';
        authBtn.href = 'login.html';
        authBtn.className = 'btn btn-secondary btn-sm';
      }
    });
  };

  root.ErlanglyAuth = ErlanglyAuth;

  // Auto-init on DOM load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ErlanglyAuth.updateNavAuthUI);
    } else {
      ErlanglyAuth.updateNavAuthUI();
    }
  }

})(typeof self !== 'undefined' ? self : this);
