/**
 * Erlangly Plans Persistence Engine (js/plans.js)
 * 
 * Rules from AGENTS.md:
 * - Single source of truth for saving/loading plans across all five tools
 * - Talks to `plans` table through Supabase client
 * - Explicit user save actions (Save Modal)
 * - Preserves data on failure without losing inputs
 */

(function(root) {
  'use strict';

  var ErlanglyPlans = {};

  /**
   * Save a Plan (Create or Update)
   *
   * @param {string} tool - 'capacity' | 'forecasting' | 'scheduling' | 'realtime' | 'simulation'
   * @param {string} name - User defined plan name
   * @param {Object} inputs - Tool input parameters
   * @param {Object} outputs - Computed outputs summary
   * @param {string} [planId] - If updating existing plan
   * @returns {Promise<Object>} Saved plan record
   */
  ErlanglyPlans.savePlan = function(tool, name, inputs, outputs, planId) {
    return root.ErlanglyAuth.getUser().then(function(user) {
      var userId = user ? user.id : 'usr_guest';

      var record = {
        user_id: userId,
        tool: tool,
        name: name.trim() || (tool.toUpperCase() + ' Plan - ' + new Date().toLocaleDateString()),
        inputs: inputs || {},
        outputs: outputs || {},
        updated_at: new Date().toISOString()
      };

      if (planId) {
        // Update existing
        return root.ErlanglySupabase
          .from('plans')
          .update(record)
          .eq('id', planId)
          .then(function(res) {
            if (res.error) throw res.error;
            return res.data ? res.data[0] : record;
          });
      } else {
        // Insert new
        return root.ErlanglySupabase
          .from('plans')
          .insert([record])
          .then(function(res) {
            if (res.error) throw res.error;
            return res.data ? res.data[0] : record;
          });
      }
    });
  };

  /**
   * List all saved plans for the active user
   *
   * @param {string} [toolFilter] - Optional filter by tool
   * @returns {Promise<Array<Object>>}
   */
  ErlanglyPlans.listPlans = function(toolFilter) {
    return root.ErlanglyAuth.getUser().then(function(user) {
      var query = root.ErlanglySupabase.from('plans').select('*');
      if (toolFilter && toolFilter !== 'all') {
        query = query.eq('tool', toolFilter);
      }
      return query.order('updated_at', { ascending: false }).then(function(res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
    });
  };

  /**
   * Load a single plan by ID
   */
  ErlanglyPlans.loadPlan = function(id) {
    return root.ErlanglySupabase
      .from('plans')
      .select('*')
      .eq('id', id)
      .then(function(res) {
        if (res.error) throw res.error;
        return res.data && res.data.length > 0 ? res.data[0] : null;
      });
  };

  /**
   * Delete a plan by ID
   */
  ErlanglyPlans.deletePlan = function(id) {
    return root.ErlanglySupabase
      .from('plans')
      .delete()
      .eq('id', id)
      .then(function(res) {
        if (res.error) throw res.error;
        return true;
      });
  };

  /**
   * Rename a plan
   */
  ErlanglyPlans.renamePlan = function(id, newName) {
    return root.ErlanglySupabase
      .from('plans')
      .update({ name: newName.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .then(function(res) {
        if (res.error) throw res.error;
        return true;
      });
  };

  /**
   * Render Standardized "Save Plan" Modal
   *
   * @param {string} tool - Tool name
   * @param {Object} inputs - Inputs to save
   * @param {Object} outputs - Computed outputs
   * @param {Function} [onSaved] - Callback
   */
  ErlanglyPlans.showSaveModal = function(tool, inputs, outputs, onSaved) {
    // Remove existing modal if open
    var oldModal = document.getElementById('erlangly-save-modal');
    if (oldModal) oldModal.remove();

    var defaultName = tool.charAt(0).toUpperCase() + tool.slice(1) + ' Plan — ' + new Date().toLocaleDateString();

    var modalOverlay = document.createElement('div');
    modalOverlay.id = 'erlangly-save-modal';
    modalOverlay.style.position = 'fixed';
    modalOverlay.style.top = '0';
    modalOverlay.style.left = '0';
    modalOverlay.style.width = '100vw';
    modalOverlay.style.height = '100vh';
    modalOverlay.style.background = 'rgba(4, 8, 16, 0.75)';
    modalOverlay.style.backdropFilter = 'blur(6px)';
    modalOverlay.style.zIndex = '99999';
    modalOverlay.style.display = 'flex';
    modalOverlay.style.alignItems = 'center';
    modalOverlay.style.justifyContent = 'center';
    modalOverlay.style.padding = 'var(--space-4)';

    modalOverlay.innerHTML = 
      '<div class="panel" style="max-width: 480px; width: 100%; box-shadow: var(--shadow-lg); border-color: var(--accent);">' +
        '<div class="panel-header">' +
          '<div class="panel-title">💾 Save ' + tool.toUpperCase() + ' Plan</div>' +
          '<button id="modal-btn-close" class="btn btn-ghost btn-sm" style="padding: 0 8px;">✕</button>' +
        '</div>' +
        '<div class="panel-body">' +
          '<div class="form-group">' +
            '<label class="form-label" for="modal-plan-name">Plan Name</label>' +
            '<input type="text" id="modal-plan-name" class="form-control" value="' + defaultName + '" placeholder="e.g. Q3 Retail Capacity Plan">' +
            '<span class="form-hint">Stored securely in your Erlangly workspace</span>' +
          '</div>' +
          '<div style="font-size: var(--text-xs); color: var(--text-muted); background: var(--bg-input); padding: var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">' +
            '<strong>Tool Type:</strong> ' + tool.toUpperCase() + '<br>' +
            '<strong>Saved at:</strong> ' + new Date().toLocaleString() +
          '</div>' +
        '</div>' +
        '<div class="panel-footer">' +
          '<button id="modal-btn-cancel" class="btn btn-ghost btn-sm">Cancel</button>' +
          '<button id="modal-btn-confirm" class="btn btn-primary btn-sm">Confirm Save</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modalOverlay);

    var inputName = modalOverlay.querySelector('#modal-plan-name');
    var btnClose = modalOverlay.querySelector('#modal-btn-close');
    var btnCancel = modalOverlay.querySelector('#modal-btn-cancel');
    var btnConfirm = modalOverlay.querySelector('#modal-btn-confirm');

    inputName.focus();
    inputName.select();

    var closeModal = function() {
      modalOverlay.remove();
    };

    btnClose.addEventListener('click', closeModal);
    btnCancel.addEventListener('click', closeModal);

    btnConfirm.addEventListener('click', function() {
      var planName = inputName.value.trim() || defaultName;
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Saving...';

      ErlanglyPlans.savePlan(tool, planName, inputs, outputs)
        .then(function(saved) {
          closeModal();
          root.ErlanglyUtils.showToast('Plan "' + planName + '" saved successfully!', 'success');
          if (onSaved) onSaved(saved);
        })
        .catch(function(err) {
          btnConfirm.disabled = false;
          btnConfirm.textContent = 'Confirm Save';
          root.ErlanglyUtils.showToast('Save failed: ' + (err.message || 'Check network'), 'error');
        });
    });
  };

  /**
   * Generate Shareable Read-Only URL for a Plan
   */
  ErlanglyPlans.createShareableLink = function(tool, planData) {
    var toolPages = {
      capacity: 'capacity.html',
      forecasting: 'forecasting.html',
      scheduling: 'scheduling.html',
      realtime: 'realtime.html',
      simulation: 'simulator.html'
    };
    var basePage = toolPages[tool] || 'capacity.html';
    var payload = encodeURIComponent(btoa(JSON.stringify(planData || {})));
    return window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + basePage + '?shared=1&data=' + payload;
  };

  /**
   * Show Share Modal with 1-Click Copy
   */
  ErlanglyPlans.showShareModal = function(tool, planName, planData) {
    var shareUrl = ErlanglyPlans.createShareableLink(tool, planData);

    var oldModal = document.getElementById('erlangly-share-modal');
    if (oldModal) oldModal.remove();

    var modalOverlay = document.createElement('div');
    modalOverlay.id = 'erlangly-share-modal';
    modalOverlay.style.position = 'fixed';
    modalOverlay.style.top = '0';
    modalOverlay.style.left = '0';
    modalOverlay.style.width = '100vw';
    modalOverlay.style.height = '100vh';
    modalOverlay.style.background = 'rgba(4, 8, 16, 0.75)';
    modalOverlay.style.backdropFilter = 'blur(6px)';
    modalOverlay.style.zIndex = '99999';
    modalOverlay.style.display = 'flex';
    modalOverlay.style.alignItems = 'center';
    modalOverlay.style.justifyContent = 'center';
    modalOverlay.style.padding = 'var(--space-4)';

    modalOverlay.innerHTML = 
      '<div class="panel" style="max-width: 520px; width: 100%; box-shadow: var(--shadow-lg); border-color: var(--accent);">' +
        '<div class="panel-header">' +
          '<div class="panel-title">🔗 Share Read-Only Plan</div>' +
          '<button id="share-modal-close" class="btn btn-ghost btn-sm" style="padding: 0 8px;">✕</button>' +
        '</div>' +
        '<div class="panel-body">' +
          '<h3 style="font-size: var(--text-base); margin-bottom: var(--space-2);">' + planName + '</h3>' +
          '<p style="font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: var(--space-4);">' +
            'Anyone with this link can view this complete workforce plan and its calculation results in read-only mode without logging in.' +
          '</p>' +
          '<div class="form-group">' +
            '<label class="form-label" for="share-url-input">Shareable Link</label>' +
            '<div class="input-group">' +
              '<input type="text" id="share-url-input" class="form-control mono" readonly value="' + shareUrl + '">' +
              '<button id="btn-copy-share-url" class="btn btn-primary btn-sm">Copy Link</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="panel-footer" style="justify-content: flex-end;">' +
          '<button id="share-modal-done" class="btn btn-secondary btn-sm">Done</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modalOverlay);

    var btnClose = modalOverlay.querySelector('#share-modal-close');
    var btnDone = modalOverlay.querySelector('#share-modal-done');
    var btnCopy = modalOverlay.querySelector('#btn-copy-share-url');
    var inputUrl = modalOverlay.querySelector('#share-url-input');

    var closeModal = function() { modalOverlay.remove(); };
    btnClose.addEventListener('click', closeModal);
    btnDone.addEventListener('click', closeModal);

    btnCopy.addEventListener('click', function() {
      inputUrl.select();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl).then(function() {
          btnCopy.textContent = 'Copied! ✓';
          btnCopy.className = 'btn btn-success btn-sm';
          setTimeout(function() {
            btnCopy.textContent = 'Copy Link';
            btnCopy.className = 'btn btn-primary btn-sm';
          }, 2000);
        });
      }
    });
  };

  root.ErlanglyPlans = ErlanglyPlans;

})(typeof self !== 'undefined' ? self : this);

