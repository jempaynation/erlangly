/**
 * Erlangly Plans Persistence & Collaboration Engine (js/plans.js)
 * 
 * Rules from AGENTS.md & Phase 11 Specification:
 * - Single source of truth for saving/loading plans across all five tools
 * - Talks to `plans`, `plan_collaborators`, and `plan_versions` through Supabase client
 * - Explicit user save actions (Save Modal)
 * - Automatic immutable version snapshots on save (append-only `plan_versions`)
 * - Three-tier permission model: Owner (full control), Editor (modify/save), Viewer (read-only)
 * - Optimistic concurrency conflict detection via `updated_at` check
 * - Visual version diffing and snapshot restoration
 * - Preserves data on failure without losing inputs
 */

(function(root) {
  'use strict';

  var ErlanglyPlans = {};

  /**
   * Deep diff comparison between two parameter objects (inputs or outputs)
   */
  ErlanglyPlans.diffObjects = function(objA, objB) {
    objA = objA || {};
    objB = objB || {};
    var allKeys = Array.from(new Set(Object.keys(objA).concat(Object.keys(objB))));
    var diffs = [];

    allKeys.forEach(function(k) {
      var valA = objA[k];
      var valB = objB[k];
      var strA = typeof valA === 'object' && valA !== null ? JSON.stringify(valA) : String(valA !== undefined ? valA : '');
      var strB = typeof valB === 'object' && valB !== null ? JSON.stringify(valB) : String(valB !== undefined ? valB : '');

      if (!(k in objA)) {
        diffs.push({ key: k, type: 'added', oldVal: null, newVal: valB, strA: '—', strB: strB });
      } else if (!(k in objB)) {
        diffs.push({ key: k, type: 'removed', oldVal: valA, newVal: null, strA: strA, strB: '—' });
      } else if (strA !== strB) {
        diffs.push({ key: k, type: 'modified', oldVal: valA, newVal: valB, strA: strA, strB: strB });
      }
    });

    return diffs;
  };

  /**
   * Diff two plan versions
   */
  ErlanglyPlans.diffPlanVersions = function(versionA, versionB) {
    if (!versionA || !versionB) return { inputDiffs: [], outputDiffs: [], totalChanges: 0 };
    var inputDiffs = ErlanglyPlans.diffObjects(versionA.inputs, versionB.inputs);
    var outputDiffs = ErlanglyPlans.diffObjects(versionA.outputs, versionB.outputs);
    return {
      inputDiffs: inputDiffs,
      outputDiffs: outputDiffs,
      totalChanges: inputDiffs.length + outputDiffs.length
    };
  };

  /**
   * Save a Plan (Create or Update with Concurrency Check & Immutable Version Snapshot)
   *
   * @param {string} tool - 'capacity' | 'forecasting' | 'scheduling' | 'realtime' | 'simulation'
   * @param {string} name - User defined plan name
   * @param {Object} inputs - Tool input parameters
   * @param {Object} outputs - Computed outputs summary
   * @param {string} [planId] - If updating existing plan
   * @param {string} [expectedUpdatedAt] - ISO timestamp for optimistic concurrency
   * @param {boolean} [forceOverwrite] - Force overwrite if conflict detected
   * @returns {Promise<Object>} Saved plan record or conflict descriptor
   */
  ErlanglyPlans.savePlan = function(tool, name, inputs, outputs, planId, expectedUpdatedAt, forceOverwrite) {
    return root.ErlanglyAuth.getUser().then(function(user) {
      var userId = user ? user.id : 'usr_guest';
      var userEmail = user ? (user.email || 'guest@erlangly.internal') : 'guest@erlangly.internal';

      var planName = (name && name.trim()) || (tool.toUpperCase() + ' Plan - ' + new Date().toLocaleDateString());

      if (planId) {
        // Step 1: Concurrency check if updating
        return root.ErlanglySupabase
          .from('plans')
          .select('*')
          .eq('id', planId)
          .then(function(res) {
            if (res.error) throw res.error;
            var currentPlan = res.data && res.data[0];

            if (currentPlan && expectedUpdatedAt && !forceOverwrite) {
              var serverTime = new Date(currentPlan.updated_at).getTime();
              var clientTime = new Date(expectedUpdatedAt).getTime();
              if (serverTime > clientTime + 1000) {
                // Conflict detected!
                return {
                  conflict: true,
                  serverPlan: currentPlan,
                  message: 'This plan was modified by another editor at ' + new Date(currentPlan.updated_at).toLocaleTimeString()
                };
              }
            }

            var record = {
              name: planName,
              inputs: inputs || {},
              outputs: outputs || {},
              updated_at: new Date().toISOString()
            };

            return root.ErlanglySupabase
              .from('plans')
              .update(record)
              .eq('id', planId)
              .select()
              .then(function(upRes) {
                if (upRes.error) throw upRes.error;
                var updatedPlan = upRes.data && upRes.data[0] ? upRes.data[0] : Object.assign({ id: planId }, record);
                
                // Create version snapshot
                return ErlanglyPlans.createVersionSnapshot(planId, planName, inputs, outputs, userId, userEmail)
                  .then(function(version) {
                    updatedPlan.version = version;
                    return updatedPlan;
                  });
              });
          });
      } else {
        // Step 2: Insert new plan
        var newRecord = {
          user_id: userId,
          tool: tool,
          name: planName,
          inputs: inputs || {},
          outputs: outputs || {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        return root.ErlanglySupabase
          .from('plans')
          .insert([newRecord])
          .select()
          .then(function(insRes) {
            if (insRes.error) throw insRes.error;
            var createdPlan = insRes.data && insRes.data[0] ? insRes.data[0] : newRecord;
            var newId = createdPlan.id;

            // Create initial v1 snapshot
            return ErlanglyPlans.createVersionSnapshot(newId, planName, inputs, outputs, userId, userEmail)
              .then(function(version) {
                createdPlan.version = version;
                return createdPlan;
              });
          });
      }
    });
  };

  /**
   * Create an immutable snapshot in `plan_versions`
   */
  ErlanglyPlans.createVersionSnapshot = function(planId, name, inputs, outputs, userId, userEmail) {
    return root.ErlanglySupabase
      .from('plan_versions')
      .select('*')
      .eq('plan_id', planId)
      .order('version_number', { ascending: false })
      .then(function(res) {
        var existingVersions = (res.data || []);
        var nextVersionNumber = existingVersions.length > 0 ? (existingVersions[0].version_number + 1) : 1;

        var versionRecord = {
          plan_id: planId,
          version_number: nextVersionNumber,
          name: name,
          inputs: inputs || {},
          outputs: outputs || {},
          created_by: userId,
          created_by_email: userEmail,
          created_at: new Date().toISOString()
        };

        return root.ErlanglySupabase
          .from('plan_versions')
          .insert([versionRecord])
          .select()
          .then(function(vRes) {
            if (vRes.error) console.warn('Could not record version snapshot:', vRes.error);
            return vRes.data && vRes.data[0] ? vRes.data[0] : versionRecord;
          });
      });
  };

  /**
   * List all plans accessible by the active user (Owned + Shared via Collaborators)
   *
   * @param {string} [toolFilter] - Optional filter by tool ('capacity' | 'forecasting' | etc.)
   * @param {string} [scopeFilter] - 'all' | 'owned' | 'shared'
   * @returns {Promise<Array<Object>>}
   */
  ErlanglyPlans.listPlans = function(toolFilter, scopeFilter) {
    return root.ErlanglyAuth.getUser().then(function(user) {
      var userId = user ? user.id : 'usr_guest';
      var userEmail = user ? (user.email || 'guest@erlangly.internal') : 'guest@erlangly.internal';

      // 1. Fetch all plans
      var plansQuery = root.ErlanglySupabase.from('plans').select('*');
      if (toolFilter && toolFilter !== 'all') {
        plansQuery = plansQuery.eq('tool', toolFilter);
      }

      return plansQuery.order('updated_at', { ascending: false }).then(function(plansRes) {
        if (plansRes.error) throw plansRes.error;
        var allPlans = plansRes.data || [];

        // 2. Fetch collaborator mappings for this user
        return root.ErlanglySupabase
          .from('plan_collaborators')
          .select('*')
          .then(function(collabRes) {
            var allCollabs = collabRes.data || [];
            var myCollabMap = {}; // plan_id -> role

            allCollabs.forEach(function(c) {
              if (c.user_id === userId || (c.user_email && c.user_email.toLowerCase() === userEmail.toLowerCase())) {
                myCollabMap[c.plan_id] = c.role;
              }
            });

            // 3. Decorate plans with roles and filter by scope
            var visiblePlans = [];

            allPlans.forEach(function(p) {
              var isOwner = p.user_id === userId;
              var collabRole = myCollabMap[p.id];

              if (isOwner) {
                p.userRole = 'owner';
              } else if (collabRole) {
                p.userRole = collabRole; // 'editor' | 'viewer'
              } else {
                // If demo/mock single user mode
                p.userRole = 'owner';
              }

              var include = true;
              if (scopeFilter === 'owned' && p.userRole !== 'owner') include = false;
              if (scopeFilter === 'shared' && p.userRole === 'owner') include = false;

              if (include) {
                visiblePlans.push(p);
              }
            });

            return visiblePlans;
          });
      });
    });
  };

  /**
   * Load a single plan by ID (decorated with permissions and version)
   */
  ErlanglyPlans.loadPlan = function(id) {
    return root.ErlanglyAuth.getUser().then(function(user) {
      var userId = user ? user.id : 'usr_guest';
      var userEmail = user ? (user.email || 'guest@erlangly.internal') : 'guest@erlangly.internal';

      return root.ErlanglySupabase
        .from('plans')
        .select('*')
        .eq('id', id)
        .then(function(res) {
          if (res.error) throw res.error;
          var plan = res.data && res.data.length > 0 ? res.data[0] : null;
          if (!plan) return null;

          // Check collaborator role
          return root.ErlanglySupabase
            .from('plan_collaborators')
            .select('*')
            .eq('plan_id', id)
            .then(function(cRes) {
              var collabs = cRes.data || [];
              plan.collaborators = collabs;
              
              var myCollab = collabs.find(function(c) {
                return c.user_id === userId || (c.user_email && c.user_email.toLowerCase() === userEmail.toLowerCase());
              });

              if (plan.user_id === userId) {
                plan.userRole = 'owner';
              } else if (myCollab) {
                plan.userRole = myCollab.role;
              } else {
                plan.userRole = 'owner';
              }

              return plan;
            });
        });
    });
  };

  /**
   * Delete a plan by ID (Owner only)
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

  /* ==========================================================================
     COLLABORATORS MANAGEMENT API
     ========================================================================== */

  /**
   * Get collaborators for a plan
   */
  ErlanglyPlans.getPlanCollaborators = function(planId) {
    return root.ErlanglySupabase
      .from('plan_collaborators')
      .select('*')
      .eq('plan_id', planId)
      .order('invited_at', { ascending: true })
      .then(function(res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  };

  /**
   * Add / invite a collaborator to a plan
   */
  ErlanglyPlans.addPlanCollaborator = function(planId, email, role) {
    return root.ErlanglyAuth.getUser().then(function(user) {
      var userId = user ? user.id : 'usr_guest';
      var cleanEmail = (email || '').trim().toLowerCase();
      var collabRole = role === 'editor' ? 'editor' : 'viewer';

      if (!cleanEmail || cleanEmail.indexOf('@') === -1) {
        return Promise.reject(new Error('Please provide a valid email address'));
      }

      var record = {
        plan_id: planId,
        user_email: cleanEmail,
        role: collabRole,
        invited_by: userId,
        invited_at: new Date().toISOString()
      };

      return root.ErlanglySupabase
        .from('plan_collaborators')
        .insert([record])
        .select()
        .then(function(res) {
          if (res.error) throw res.error;
          return res.data && res.data[0] ? res.data[0] : record;
        });
    });
  };

  /**
   * Remove a collaborator from a plan
   */
  ErlanglyPlans.removePlanCollaborator = function(collaboratorId) {
    return root.ErlanglySupabase
      .from('plan_collaborators')
      .delete()
      .eq('id', collaboratorId)
      .then(function(res) {
        if (res.error) throw res.error;
        return true;
      });
  };

  /**
   * Update a collaborator's role ('editor' <-> 'viewer')
   */
  ErlanglyPlans.updateCollaboratorRole = function(collaboratorId, newRole) {
    var validRole = newRole === 'editor' ? 'editor' : 'viewer';
    return root.ErlanglySupabase
      .from('plan_collaborators')
      .update({ role: validRole })
      .eq('id', collaboratorId)
      .select()
      .then(function(res) {
        if (res.error) throw res.error;
        return true;
      });
  };

  /* ==========================================================================
     VERSION HISTORY & DIFF API
     ========================================================================== */

  /**
   * Get all version snapshots for a plan
   */
  ErlanglyPlans.getPlanVersions = function(planId) {
    return root.ErlanglySupabase
      .from('plan_versions')
      .select('*')
      .eq('plan_id', planId)
      .order('version_number', { ascending: false })
      .then(function(res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  };

  /**
   * Restore a historical version snapshot
   */
  ErlanglyPlans.restorePlanVersion = function(planId, versionId) {
    return root.ErlanglyAuth.getUser().then(function(user) {
      var userId = user ? user.id : 'usr_guest';
      var userEmail = user ? (user.email || 'guest@erlangly.internal') : 'guest@erlangly.internal';

      return root.ErlanglySupabase
        .from('plan_versions')
        .select('*')
        .eq('id', versionId)
        .then(function(res) {
          if (res.error) throw res.error;
          var versionToRestore = res.data && res.data[0];
          if (!versionToRestore) {
            throw new Error('Version snapshot not found');
          }

          var restoredInputs = versionToRestore.inputs || {};
          var restoredOutputs = versionToRestore.outputs || {};
          var note = ' (Restored from v' + versionToRestore.version_number + ')';
          var restoredName = (versionToRestore.name || 'Plan') + note;

          return ErlanglyPlans.savePlan(
            'capacity', // Default tool identifier; overwritten by actual update
            restoredName,
            restoredInputs,
            restoredOutputs,
            planId,
            null,
            true // force overwrite
          );
        });
    });
  };

  /* ==========================================================================
     UI MODALS (Save, Collaborators, Version Timeline, Diff, Conflict)
     ========================================================================== */

  /**
   * Render Standardized "Save Plan" Modal with Concurrency & Conflict Protection
   */
  ErlanglyPlans.showSaveModal = function(tool, inputs, outputs, onSaved, planId, currentUpdatedAt) {
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
          '<div class="panel-title">💾 ' + (planId ? 'Update & Snapshot Plan' : 'Save New ' + tool.toUpperCase() + ' Plan') + '</div>' +
          '<button id="modal-btn-close" class="btn btn-ghost btn-sm" style="padding: 0 8px;">✕</button>' +
        '</div>' +
        '<div class="panel-body">' +
          '<div class="form-group">' +
            '<label class="form-label" for="modal-plan-name">Plan Name</label>' +
            '<input type="text" id="modal-plan-name" class="form-control" value="' + defaultName + '" placeholder="e.g. Q3 Retail Capacity Plan">' +
            '<span class="form-hint">Automatically records an immutable version snapshot on save.</span>' +
          '</div>' +
          '<div style="font-size: var(--text-xs); color: var(--text-muted); background: var(--bg-input); padding: var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">' +
            '<strong>Tool Type:</strong> ' + tool.toUpperCase() + '<br>' +
            '<strong>Timestamp:</strong> ' + new Date().toLocaleString() +
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

    var closeModal = function() { modalOverlay.remove(); };
    btnClose.addEventListener('click', closeModal);
    btnCancel.addEventListener('click', closeModal);

    btnConfirm.addEventListener('click', function() {
      var planName = inputName.value.trim() || defaultName;
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Saving...';

      ErlanglyPlans.savePlan(tool, planName, inputs, outputs, planId, currentUpdatedAt)
        .then(function(result) {
          if (result && result.conflict) {
            closeModal();
            ErlanglyPlans.showConflictModal(result.serverPlan, inputs, outputs, function(resolved) {
              if (onSaved) onSaved(resolved);
            });
          } else {
            closeModal();
            root.ErlanglyUtils.showToast('Plan "' + planName + '" saved successfully (v' + (result && result.version ? result.version.version_number : 1) + ')!', 'success');
            if (onSaved) onSaved(result);
          }
        })
        .catch(function(err) {
          btnConfirm.disabled = false;
          btnConfirm.textContent = 'Confirm Save';
          root.ErlanglyUtils.showToast('Save failed: ' + (err.message || 'Check network'), 'error');
        });
    });
  };

  /**
   * Show Optimistic Concurrency Conflict Modal
   */
  ErlanglyPlans.showConflictModal = function(serverPlan, localInputs, localOutputs, onResolve) {
    var oldModal = document.getElementById('erlangly-conflict-modal');
    if (oldModal) oldModal.remove();

    var modalOverlay = document.createElement('div');
    modalOverlay.id = 'erlangly-conflict-modal';
    modalOverlay.style.position = 'fixed';
    modalOverlay.style.top = '0';
    modalOverlay.style.left = '0';
    modalOverlay.style.width = '100vw';
    modalOverlay.style.height = '100vh';
    modalOverlay.style.background = 'rgba(4, 8, 16, 0.85)';
    modalOverlay.style.backdropFilter = 'blur(8px)';
    modalOverlay.style.zIndex = '999999';
    modalOverlay.style.display = 'flex';
    modalOverlay.style.alignItems = 'center';
    modalOverlay.style.justifyContent = 'center';
    modalOverlay.style.padding = 'var(--space-4)';

    var serverUpdatedStr = new Date(serverPlan.updated_at).toLocaleString();

    modalOverlay.innerHTML = 
      '<div class="panel" style="max-width: 540px; width: 100%; box-shadow: var(--shadow-lg); border-color: var(--warn);">' +
        '<div class="panel-header" style="background: rgba(254, 202, 87, 0.1);">' +
          '<div class="panel-title" style="color: var(--warn);">⚠️ Concurrent Edit Conflict Detected</div>' +
          '<button id="conflict-modal-close" class="btn btn-ghost btn-sm">✕</button>' +
        '</div>' +
        '<div class="panel-body">' +
          '<p style="font-size: var(--text-sm); color: var(--text-primary); margin-bottom: var(--space-3);">' +
            'Another teammate saved changes to <strong>"' + serverPlan.name + '"</strong> at <strong>' + serverUpdatedStr + '</strong> while you were working.' +
          '</p>' +
          '<p style="font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: var(--space-4);">' +
            'Please select how you would like to resolve this conflict to prevent accidental overwrites.' +
          '</p>' +
          '<div style="display: flex; flex-direction: column; gap: var(--space-3);">' +
            '<button id="btn-conflict-overwrite" class="btn btn-primary btn-sm" style="text-align: left; justify-content: flex-start; background: var(--warn); color: var(--bg-body);">' +
              '⚡ Overwrite Remote with My Local Changes' +
            '</button>' +
            '<button id="btn-conflict-reload" class="btn btn-secondary btn-sm" style="text-align: left; justify-content: flex-start;">' +
              '🔄 Discard Local &amp; Reload Latest Server Plan' +
            '</button>' +
            '<button id="btn-conflict-save-new" class="btn btn-ghost btn-sm" style="text-align: left; justify-content: flex-start; border: 1px solid var(--border-default);">' +
              '💾 Save My Changes as a New Independent Plan' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modalOverlay);

    var closeModal = function() { modalOverlay.remove(); };
    modalOverlay.querySelector('#conflict-modal-close').addEventListener('click', closeModal);

    modalOverlay.querySelector('#btn-conflict-overwrite').addEventListener('click', function() {
      closeModal();
      ErlanglyPlans.savePlan(serverPlan.tool, serverPlan.name, localInputs, localOutputs, serverPlan.id, null, true)
        .then(function(saved) {
          root.ErlanglyUtils.showToast('Overwrote server plan with local changes.', 'warn');
          if (onResolve) onResolve(saved);
        });
    });

    modalOverlay.querySelector('#btn-conflict-reload').addEventListener('click', function() {
      closeModal();
      root.ErlanglyUtils.setHandoff(serverPlan.tool, serverPlan.inputs);
      window.location.reload();
    });

    modalOverlay.querySelector('#btn-conflict-save-new').addEventListener('click', function() {
      closeModal();
      var forkName = serverPlan.name + ' (Local Copy ' + new Date().toLocaleTimeString() + ')';
      ErlanglyPlans.savePlan(serverPlan.tool, forkName, localInputs, localOutputs)
        .then(function(saved) {
          root.ErlanglyUtils.showToast('Saved as new plan "' + forkName + '"', 'success');
          if (onResolve) onResolve(saved);
        });
    });
  };

  /**
   * Show Team Collaborators Modal
   */
  ErlanglyPlans.showCollaboratorsModal = function(plan, onUpdate) {
    var oldModal = document.getElementById('erlangly-collab-modal');
    if (oldModal) oldModal.remove();

    var modalOverlay = document.createElement('div');
    modalOverlay.id = 'erlangly-collab-modal';
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

    var isOwner = plan.userRole === 'owner';

    modalOverlay.innerHTML = 
      '<div class="panel" style="max-width: 580px; width: 100%; box-shadow: var(--shadow-lg); border-color: var(--accent);">' +
        '<div class="panel-header">' +
          '<div class="panel-title">👥 Manage Collaborators &amp; Access</div>' +
          '<button id="collab-modal-close" class="btn btn-ghost btn-sm">✕</button>' +
        '</div>' +
        '<div class="panel-body">' +
          '<h3 style="font-size: var(--text-base); margin-bottom: var(--space-1);">' + plan.name + '</h3>' +
          '<p style="font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: var(--space-4);">' +
            'Invite teammates to co-author or review this workforce plan.' +
          '</p>' +
          
          (isOwner ? 
            '<div style="display: flex; gap: var(--space-2); margin-bottom: var(--space-4);">' +
              '<input type="email" id="input-collab-email" class="form-control" placeholder="colleague@company.com" style="flex: 1;">' +
              '<select id="select-collab-role" class="form-control mono" style="width: 110px;">' +
                '<option value="editor">Editor</option>' +
                '<option value="viewer">Viewer</option>' +
              '</select>' +
              '<button id="btn-invite-collab" class="btn btn-primary btn-sm">Invite</button>' +
            '</div>' : 
            '<div class="badge badge-warning" style="margin-bottom: var(--space-4);">Viewer mode: Only the plan owner can invite teammates.</div>'
          ) +

          '<div style="border-top: 1px solid var(--border-subtle); padding-top: var(--space-3);">' +
            '<div style="font-size: var(--text-xs); font-family: var(--mono); color: var(--text-muted); margin-bottom: var(--space-2);">ACTIVE TEAM MEMBERS</div>' +
            '<div id="collab-list-container" style="display: flex; flex-direction: column; gap: var(--space-2); max-height: 220px; overflow-y: auto;">' +
              '<div style="font-size: var(--text-xs); color: var(--text-muted);">Loading collaborators...</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="panel-footer" style="justify-content: flex-end;">' +
          '<button id="collab-modal-done" class="btn btn-secondary btn-sm">Done</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modalOverlay);

    var closeModal = function() { modalOverlay.remove(); };
    modalOverlay.querySelector('#collab-modal-close').addEventListener('click', closeModal);
    modalOverlay.querySelector('#collab-modal-done').addEventListener('click', closeModal);

    var collabList = modalOverlay.querySelector('#collab-list-container');

    function renderCollaborators() {
      ErlanglyPlans.getPlanCollaborators(plan.id).then(function(collabs) {
        collabList.innerHTML = '';

        // Add Owner Row
        var ownerRow = document.createElement('div');
        ownerRow.style.display = 'flex';
        ownerRow.style.justifyContent = 'space-between';
        ownerRow.style.alignItems = 'center';
        ownerRow.style.padding = 'var(--space-2) var(--space-3)';
        ownerRow.style.background = 'var(--bg-surface-elevated)';
        ownerRow.style.borderRadius = 'var(--radius-md)';
        ownerRow.innerHTML = 
          '<div style="display: flex; align-items: center; gap: var(--space-2);">' +
            '<span>👑</span>' +
            '<span style="font-size: var(--text-xs); font-weight: 600;">Plan Owner</span>' +
          '</div>' +
          '<span class="badge badge-accent">Owner (Full Control)</span>';
        collabList.appendChild(ownerRow);

        if (collabs.length === 0) {
          var emptyNote = document.createElement('div');
          emptyNote.style.fontSize = 'var(--text-xs)';
          emptyNote.style.color = 'var(--text-muted)';
          emptyNote.style.padding = 'var(--space-2)';
          emptyNote.textContent = 'No teammates invited yet. Enter an email above to share.';
          collabList.appendChild(emptyNote);
          return;
        }

        collabs.forEach(function(c) {
          var row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.style.padding = 'var(--space-2) var(--space-3)';
          row.style.background = 'var(--bg-input)';
          row.style.borderRadius = 'var(--radius-md)';
          row.style.border = '1px solid var(--border-subtle)';

          var roleBadgeClass = c.role === 'editor' ? 'badge-success' : 'badge-warning';

          row.innerHTML = 
            '<div style="display: flex; flex-direction: column;">' +
              '<span style="font-size: var(--text-xs); font-weight: 500;">' + c.user_email + '</span>' +
              '<span style="font-size: 10px; color: var(--text-muted);">Invited: ' + new Date(c.invited_at).toLocaleDateString() + '</span>' +
            '</div>' +
            '<div style="display: flex; align-items: center; gap: var(--space-2);">' +
              (isOwner ? 
                '<select class="form-control mono btn-change-role" style="font-size: 11px; height: 26px; width: 85px;">' +
                  '<option value="editor"' + (c.role === 'editor' ? ' selected' : '') + '>Editor</option>' +
                  '<option value="viewer"' + (c.role === 'viewer' ? ' selected' : '') + '>Viewer</option>' +
                '</select>' +
                '<button class="btn btn-ghost btn-sm btn-remove-collab" style="color: var(--danger); padding: 0 6px;" title="Remove collaborator">✕</button>' :
                '<span class="badge ' + roleBadgeClass + '">' + c.role.toUpperCase() + '</span>'
              ) +
            '</div>';

          if (isOwner) {
            row.querySelector('.btn-change-role').addEventListener('change', function(e) {
              ErlanglyPlans.updateCollaboratorRole(c.id, e.target.value).then(function() {
                root.ErlanglyUtils.showToast('Updated ' + c.user_email + ' to ' + e.target.value, 'info');
                renderCollaborators();
                if (onUpdate) onUpdate();
              });
            });

            row.querySelector('.btn-remove-collab').addEventListener('click', function() {
              if (confirm('Remove access for ' + c.user_email + '?')) {
                ErlanglyPlans.removePlanCollaborator(c.id).then(function() {
                  root.ErlanglyUtils.showToast('Removed ' + c.user_email, 'info');
                  renderCollaborators();
                  if (onUpdate) onUpdate();
                });
              }
            });
          }

          collabList.appendChild(row);
        });
      });
    }

    renderCollaborators();

    if (isOwner) {
      var btnInvite = modalOverlay.querySelector('#btn-invite-collab');
      var inputEmail = modalOverlay.querySelector('#input-collab-email');
      var selectRole = modalOverlay.querySelector('#select-collab-role');

      btnInvite.addEventListener('click', function() {
        var email = inputEmail.value.trim();
        var role = selectRole.value;
        if (!email) return;

        btnInvite.disabled = true;
        btnInvite.textContent = 'Inviting...';

        ErlanglyPlans.addPlanCollaborator(plan.id, email, role)
          .then(function() {
            inputEmail.value = '';
            btnInvite.disabled = false;
            btnInvite.textContent = 'Invite';
            root.ErlanglyUtils.showToast('Invited ' + email + ' as ' + role, 'success');
            renderCollaborators();
            if (onUpdate) onUpdate();
          })
          .catch(function(err) {
            btnInvite.disabled = false;
            btnInvite.textContent = 'Invite';
            root.ErlanglyUtils.showToast('Invite error: ' + err.message, 'error');
          });
      });
    }
  };

  /**
   * Show Version History Timeline Modal with Diff & Restore Actions
   */
  ErlanglyPlans.showVersionHistoryModal = function(plan, onRestore) {
    var oldModal = document.getElementById('erlangly-version-modal');
    if (oldModal) oldModal.remove();

    var modalOverlay = document.createElement('div');
    modalOverlay.id = 'erlangly-version-modal';
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
      '<div class="panel" style="max-width: 640px; width: 100%; box-shadow: var(--shadow-lg); border-color: var(--accent);">' +
        '<div class="panel-header">' +
          '<div class="panel-title">📜 Version History &amp; Snapshots</div>' +
          '<button id="version-modal-close" class="btn btn-ghost btn-sm">✕</button>' +
        '</div>' +
        '<div class="panel-body">' +
          '<h3 style="font-size: var(--text-base); margin-bottom: var(--space-1);">' + plan.name + '</h3>' +
          '<p style="font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: var(--space-4);">' +
            'Every save creates an immutable snapshot. Compare parameter deltas or restore previous models.' +
          '</p>' +
          '<div id="version-timeline-container" style="display: flex; flex-direction: column; gap: var(--space-3); max-height: 320px; overflow-y: auto;">' +
            '<div style="font-size: var(--text-xs); color: var(--text-muted);">Loading version history...</div>' +
          '</div>' +
        '</div>' +
        '<div class="panel-footer" style="justify-content: flex-end;">' +
          '<button id="version-modal-done" class="btn btn-secondary btn-sm">Done</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modalOverlay);

    var closeModal = function() { modalOverlay.remove(); };
    modalOverlay.querySelector('#version-modal-close').addEventListener('click', closeModal);
    modalOverlay.querySelector('#version-modal-done').addEventListener('click', closeModal);

    var timelineList = modalOverlay.querySelector('#version-timeline-container');

    ErlanglyPlans.getPlanVersions(plan.id).then(function(versions) {
      timelineList.innerHTML = '';
      if (!versions || versions.length === 0) {
        timelineList.innerHTML = '<div style="font-size: var(--text-xs); color: var(--text-muted);">No version history recorded yet. Saving this plan will create v1.</div>';
        return;
      }

      versions.forEach(function(v, idx) {
        var card = document.createElement('div');
        card.style.background = 'var(--bg-input)';
        card.style.border = '1px solid var(--border-subtle)';
        card.style.borderRadius = 'var(--radius-md)';
        card.style.padding = 'var(--space-3)';
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';
        card.style.gap = 'var(--space-3)';

        var prevVersion = versions[idx + 1]; // Older version for comparison

        var dateStr = new Date(v.created_at).toLocaleString();
        var author = v.created_by_email || 'System';

        card.innerHTML = 
          '<div style="display: flex; gap: var(--space-3); align-items: center;">' +
            '<span class="badge badge-accent mono" style="font-size: 13px; font-weight: 700;">v' + v.version_number + '</span>' +
            '<div>' +
              '<div style="font-size: var(--text-xs); font-weight: 600; color: var(--text-primary);">' + (v.name || 'Snapshot') + '</div>' +
              '<div style="font-size: 11px; color: var(--text-muted);">' + author + ' &bull; ' + dateStr + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display: flex; gap: var(--space-2);">' +
            (prevVersion ? 
              '<button class="btn btn-ghost btn-sm btn-diff-version" style="font-size: 11px;">🔍 Diff vs v' + prevVersion.version_number + '</button>' : 
              '<span style="font-size: 10px; color: var(--text-muted); padding: 4px;">Initial v1</span>'
            ) +
            (plan.userRole !== 'viewer' ? 
              '<button class="btn btn-secondary btn-sm btn-restore-version" style="font-size: 11px;">↩ Restore</button>' : ''
            ) +
          '</div>';

        var btnDiff = card.querySelector('.btn-diff-version');
        if (btnDiff) {
          btnDiff.addEventListener('click', function() {
            ErlanglyPlans.showDiffModal(prevVersion, v);
          });
        }

        var btnRestore = card.querySelector('.btn-restore-version');
        if (btnRestore) {
          btnRestore.addEventListener('click', function() {
            if (confirm('Restore plan state to v' + v.version_number + '? (This will create a new version snapshot)')) {
              ErlanglyPlans.restorePlanVersion(plan.id, v.id).then(function() {
                closeModal();
                root.ErlanglyUtils.showToast('Restored to v' + v.version_number + ' successfully!', 'success');
                if (onRestore) onRestore();
              });
            }
          });
        }

        timelineList.appendChild(card);
      });
    });
  };

  /**
   * Show Visual Parameter Diff Modal between Two Versions
   */
  ErlanglyPlans.showDiffModal = function(versionA, versionB) {
    var oldModal = document.getElementById('erlangly-diff-modal');
    if (oldModal) oldModal.remove();

    var diffResults = ErlanglyPlans.diffPlanVersions(versionA, versionB);

    var modalOverlay = document.createElement('div');
    modalOverlay.id = 'erlangly-diff-modal';
    modalOverlay.style.position = 'fixed';
    modalOverlay.style.top = '0';
    modalOverlay.style.left = '0';
    modalOverlay.style.width = '100vw';
    modalOverlay.style.height = '100vh';
    modalOverlay.style.background = 'rgba(4, 8, 16, 0.85)';
    modalOverlay.style.backdropFilter = 'blur(8px)';
    modalOverlay.style.zIndex = '999999';
    modalOverlay.style.display = 'flex';
    modalOverlay.style.alignItems = 'center';
    modalOverlay.style.justifyContent = 'center';
    modalOverlay.style.padding = 'var(--space-4)';

    var diffRowsHtml = '';

    if (diffResults.inputDiffs.length === 0 && diffResults.outputDiffs.length === 0) {
      diffRowsHtml = '<div style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No parameter differences between v' + versionA.version_number + ' and v' + versionB.version_number + '.</div>';
    } else {
      diffResults.inputDiffs.forEach(function(d) {
        var badgeColor = d.type === 'modified' ? 'var(--warn)' : (d.type === 'added' ? 'var(--accent)' : 'var(--danger)');
        diffRowsHtml += 
          '<tr style="border-bottom: 1px solid var(--border-subtle); font-size: var(--text-xs);">' +
            '<td style="padding: 8px; font-weight: 600; font-family: var(--mono);">' + d.key + '</td>' +
            '<td style="padding: 8px;"><span class="badge" style="background: rgba(255,255,255,0.05); color: ' + badgeColor + ';">' + d.type.toUpperCase() + '</span></td>' +
            '<td style="padding: 8px; color: var(--text-muted); font-family: var(--mono);">' + d.strA + '</td>' +
            '<td style="padding: 8px; color: var(--accent); font-weight: 600; font-family: var(--mono);">' + d.strB + '</td>' +
          '</tr>';
      });
    }

    modalOverlay.innerHTML = 
      '<div class="panel" style="max-width: 680px; width: 100%; box-shadow: var(--shadow-lg); border-color: var(--accent);">' +
        '<div class="panel-header">' +
          '<div class="panel-title">🔍 Diff View: v' + versionA.version_number + ' ➔ v' + versionB.version_number + '</div>' +
          '<button id="diff-modal-close" class="btn btn-ghost btn-sm">✕</button>' +
        '</div>' +
        '<div class="panel-body">' +
          '<div style="font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: var(--space-3);">' +
            'Comparing parameters between <strong>v' + versionA.version_number + '</strong> (' + new Date(versionA.created_at).toLocaleTimeString() + ') and <strong>v' + versionB.version_number + '</strong> (' + new Date(versionB.created_at).toLocaleTimeString() + '):' +
          '</div>' +
          '<div style="max-height: 280px; overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">' +
            '<table style="width: 100%; border-collapse: collapse; text-align: left;">' +
              '<thead>' +
                '<tr style="background: var(--bg-surface-elevated); border-bottom: 1px solid var(--border-default); font-size: 11px; font-family: var(--mono);">' +
                  '<th style="padding: 8px;">Parameter</th>' +
                  '<th style="padding: 8px;">Status</th>' +
                  '<th style="padding: 8px;">v' + versionA.version_number + ' (Old)</th>' +
                  '<th style="padding: 8px;">v' + versionB.version_number + ' (New)</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                diffRowsHtml +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
        '<div class="panel-footer" style="justify-content: flex-end;">' +
          '<button id="diff-modal-done" class="btn btn-primary btn-sm">Close</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modalOverlay);

    var closeModal = function() { modalOverlay.remove(); };
    modalOverlay.querySelector('#diff-modal-close').addEventListener('click', closeModal);
    modalOverlay.querySelector('#diff-modal-done').addEventListener('click', closeModal);
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

  /**
   * Show Supabase Connection Settings & Diagnostic Modal
   */
  ErlanglyPlans.showConnectionModal = function(onSave) {
    var oldModal = document.getElementById('erlangly-conn-modal');
    if (oldModal) oldModal.remove();

    var cfg = (root.ErlanglySupabaseConfig ? root.ErlanglySupabaseConfig.getCredentials() : {});
    var status = (root.ErlanglySupabaseConfig ? root.ErlanglySupabaseConfig.getConnectionStatus() : { isLive: false });

    var modalOverlay = document.createElement('div');
    modalOverlay.id = 'erlangly-conn-modal';
    modalOverlay.style.position = 'fixed';
    modalOverlay.style.top = '0';
    modalOverlay.style.left = '0';
    modalOverlay.style.width = '100vw';
    modalOverlay.style.height = '100vh';
    modalOverlay.style.background = 'rgba(4, 8, 16, 0.85)';
    modalOverlay.style.backdropFilter = 'blur(8px)';
    modalOverlay.style.zIndex = '999999';
    modalOverlay.style.display = 'flex';
    modalOverlay.style.alignItems = 'center';
    modalOverlay.style.justifyContent = 'center';
    modalOverlay.style.padding = 'var(--space-4)';

    var statusBadge = status.isLive ?
      '<span class="badge badge-success" style="font-size: 12px; padding: 4px 8px;">🟢 Live Supabase Connected</span>' :
      '<span class="badge badge-warning" style="font-size: 12px; padding: 4px 8px;">🟡 Local Browser Sandbox</span>';

    modalOverlay.innerHTML = 
      '<div class="panel" style="max-width: 580px; width: 100%; box-shadow: var(--shadow-lg); border-color: var(--accent); max-height: 90vh; display: flex; flex-direction: column;">' +
        '<div class="panel-header" style="flex-shrink: 0;">' +
          '<div style="display: flex; align-items: center; gap: var(--space-2);">' +
            '<div class="panel-title">⚡ Supabase Database Connection</div>' +
          '</div>' +
          '<button id="conn-modal-close" class="btn btn-ghost btn-sm" style="padding: 0 8px;">✕</button>' +
        '</div>' +
        '<div class="panel-body" style="overflow-y: auto; padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-4);">' +
          '<div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface-elevated); padding: var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--border-default);">' +
            '<div>' +
              '<div style="font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; font-family: var(--mono);">Current Status</div>' +
              '<div style="font-size: var(--text-sm); font-weight: 600; margin-top: 2px;">' + (status.isLive ? (status.projectRef || 'Live Database') : 'Local Offline Sandbox') + '</div>' +
            '</div>' +
            statusBadge +
          '</div>' +

          '<p style="font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.5;">' +
            'Connect your Supabase PostgreSQL database to enable durable cross-device cloud persistence, magic link authentication, and real-time team collaboration.' +
          '</p>' +

          '<div class="form-group">' +
            '<label class="form-label" for="input-supabase-url">Supabase Project URL</label>' +
            '<input type="url" id="input-supabase-url" class="form-control mono" placeholder="https://xyzcompany.supabase.co" value="' + (cfg.url !== 'https://demo.supabase.co' ? (cfg.url || '') : '') + '">' +
            '<span class="form-hint">Found in Supabase Dashboard &gt; Project Settings &gt; API &gt; Project URL</span>' +
          '</div>' +

          '<div class="form-group">' +
            '<label class="form-label" for="input-supabase-anon-key">Supabase Public Anon Key</label>' +
            '<input type="password" id="input-supabase-anon-key" class="form-control mono" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." value="' + (cfg.anonKey && cfg.anonKey.indexOf('.demo') === -1 ? cfg.anonKey : '') + '">' +
            '<span class="form-hint">Public anon/public key (safe to ship client-side). Never use the service_role key!</span>' +
          '</div>' +

          '<div id="conn-test-result" style="display: none; padding: var(--space-3); border-radius: var(--radius-md); font-size: var(--text-xs); line-height: 1.4;"></div>' +

          '<div style="background: var(--bg-input); padding: var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); font-size: var(--text-xs); color: var(--text-muted);">' +
            '<strong>⚡ First Time Setup Checklist:</strong><br>' +
            '1. In Supabase Dashboard, go to <strong>SQL Editor</strong> and run <code>sql/schema.sql</code>.<br>' +
            '2. In <strong>Authentication &gt; URL Configuration</strong>, add your Vercel URL to <strong>Redirect URLs</strong>.<br>' +
            '3. Paste your Project URL and Anon Key above and click <strong>Test &amp; Connect</strong>.' +
          '</div>' +
        '</div>' +
        '<div class="panel-footer" style="justify-content: space-between; flex-shrink: 0; flex-wrap: wrap; gap: var(--space-2);">' +
          '<button id="btn-conn-reset" class="btn btn-ghost btn-sm" style="color: var(--danger);">Reset to Local Sandbox</button>' +
          '<div style="display: flex; gap: var(--space-2);">' +
            '<button id="btn-conn-test" class="btn btn-secondary btn-sm">🔍 Test Connection</button>' +
            '<button id="btn-conn-save" class="btn btn-primary btn-sm">💾 Save &amp; Connect</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modalOverlay);

    var closeModal = function() { modalOverlay.remove(); };
    modalOverlay.querySelector('#conn-modal-close').addEventListener('click', closeModal);

    var inputUrl = modalOverlay.querySelector('#input-supabase-url');
    var inputKey = modalOverlay.querySelector('#input-supabase-anon-key');
    var btnTest = modalOverlay.querySelector('#btn-conn-test');
    var btnSave = modalOverlay.querySelector('#btn-conn-save');
    var btnReset = modalOverlay.querySelector('#btn-conn-reset');
    var resultDiv = modalOverlay.querySelector('#conn-test-result');

    btnTest.addEventListener('click', function() {
      var testUrl = inputUrl.value.trim();
      var testKey = inputKey.value.trim();

      btnTest.disabled = true;
      btnTest.textContent = 'Testing...';
      resultDiv.style.display = 'block';
      resultDiv.style.background = 'var(--bg-surface-elevated)';
      resultDiv.style.color = 'var(--text-primary)';
      resultDiv.style.border = '1px solid var(--border-default)';
      resultDiv.textContent = 'Connecting to Supabase...';

      root.ErlanglySupabaseConfig.testConnection(testUrl, testKey).then(function(res) {
        btnTest.disabled = false;
        btnTest.textContent = '🔍 Test Connection';
        if (res.success) {
          resultDiv.style.background = 'rgba(46, 213, 115, 0.15)';
          resultDiv.style.color = 'var(--success)';
          resultDiv.style.border = '1px solid var(--success)';
          resultDiv.textContent = '✓ ' + (res.message || 'Connection test successful! Database is accessible.');
        } else {
          resultDiv.style.background = 'rgba(255, 71, 87, 0.15)';
          resultDiv.style.color = 'var(--danger)';
          resultDiv.style.border = '1px solid var(--danger)';
          resultDiv.textContent = '✗ ' + res.error;
        }
      });
    });

    btnSave.addEventListener('click', function() {
      var url = inputUrl.value.trim();
      var key = inputKey.value.trim();

      if (!url || !key) {
        alert('Please enter both Supabase Project URL and Anon Key, or click "Reset to Local Sandbox".');
        return;
      }

      btnSave.disabled = true;
      btnSave.textContent = 'Saving...';

      root.ErlanglySupabaseConfig.setCredentials(url, key, false);
      if (root.ErlanglyUtils && root.ErlanglyUtils.showToast) {
        root.ErlanglyUtils.showToast('Supabase credentials saved! Reloading application...', 'success');
      }
      setTimeout(function() {
        window.location.reload();
      }, 600);
    });

    btnReset.addEventListener('click', function() {
      if (confirm('Reset to offline local browser sandbox? Cloud plans will not be synced until you reconnect.')) {
        root.ErlanglySupabaseConfig.clearCredentials(false);
        if (root.ErlanglyUtils && root.ErlanglyUtils.showToast) {
          root.ErlanglyUtils.showToast('Reset to local sandbox.', 'info');
        }
        setTimeout(function() {
          window.location.reload();
        }, 500);
      }
    });
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErlanglyPlans;
  }
  root.ErlanglyPlans = ErlanglyPlans;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
