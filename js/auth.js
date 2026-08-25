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
   * Update Global Navigation Bar with Auth State & Global LIVE Indicator
   */
  ErlanglyAuth.updateNavAuthUI = function() {
    var authBtn = document.getElementById('nav-auth-btn');
    var navActions = document.querySelector('.nav-actions');

    // Global LIVE / OFFLINE Status Indicator in Navigation Bar
    if (navActions) {
      var liveBadge = document.getElementById('nav-global-live-indicator');
      if (!liveBadge) {
        liveBadge = document.createElement('span');
        liveBadge.id = 'nav-global-live-indicator';
        liveBadge.style.display = 'inline-flex';
        liveBadge.style.alignItems = 'center';
        liveBadge.style.gap = '4px';
        liveBadge.style.fontSize = '10px';
        liveBadge.style.padding = '2px 8px';
        liveBadge.style.fontWeight = '700';
        liveBadge.style.letterSpacing = '0.05em';
        liveBadge.style.cursor = 'pointer';
        liveBadge.title = 'Cloud Sync Status';
        liveBadge.addEventListener('click', function() {
          if (root.ErlanglyPlans && root.ErlanglyPlans.showConnectionModal) {
            root.ErlanglyPlans.showConnectionModal();
          } else if (typeof window !== 'undefined' && window.location.pathname.indexOf('plans.html') === -1) {
            window.location.href = 'plans.html';
          }
        });
        if (authBtn) {
          navActions.insertBefore(liveBadge, authBtn);
        } else {
          navActions.appendChild(liveBadge);
        }
      }

      var isLive = false;
      if (root.ErlanglySupabaseConfig && root.ErlanglySupabaseConfig.getConnectionStatus) {
        isLive = root.ErlanglySupabaseConfig.getConnectionStatus().isLive;
      }
      if (isLive) {
        liveBadge.className = 'badge badge-success';
        liveBadge.innerHTML = '<span style="width: 6px; height: 6px; border-radius: 50%; background: var(--success); display: inline-block; box-shadow: 0 0 6px var(--success);"></span>LIVE';
      } else {
        liveBadge.className = 'badge badge-warn';
        liveBadge.innerHTML = '<span style="width: 6px; height: 6px; border-radius: 50%; background: var(--warn); display: inline-block;"></span>OFFLINE';
      }
    }

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
