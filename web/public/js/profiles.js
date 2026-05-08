import { state, dom } from './state.js';
import { send } from './ws.js';
import { escapeHtml } from './utils.js';

export function showProfilePicker(profiles, active) {
  state.cachedProfiles = profiles;
  state.cachedActiveProfile = active;

  const nameEl = document.getElementById('profile-name');
  if (nameEl) nameEl.textContent = active || '\u2014';

  if (profiles.length === 0) { showFirstTimeProfileSetup(); return; }
  if (!active && profiles.length > 0) { send({ type: 'select_profile', name: profiles[0].name }); return; }
  if (active) send({ type: 'check_onboarding' });
}

export function hideProfilePicker() {
  const picker = document.getElementById('profile-picker');
  if (picker) { picker.classList.add('fading'); setTimeout(() => picker.remove(), 300); }
  const nameEl = document.getElementById('profile-name');
  if (nameEl && state.cachedActiveProfile) nameEl.textContent = state.cachedActiveProfile;
}

export function handleProfileSelected(msg) {
  state.cachedActiveProfile = msg.name;
  state.cachedProfiles = msg.profiles || state.cachedProfiles;
  document.getElementById('profile-name').textContent = msg.name;
  hideProfilePicker();
  state.currentConversationId = null;
  dom.messages.innerHTML = '';
  send({ type: 'check_onboarding' });
}

export function handleProfileDeleted(msg) {
  state.cachedProfiles = msg.profiles || [];
  state.cachedActiveProfile = msg.active;
  document.getElementById('profile-name').textContent = msg.active || '\u2014';
  state.currentConversationId = null;
  dom.messages.innerHTML = '';
  if (!msg.active) showFirstTimeProfileSetup();
  else send({ type: 'check_onboarding' });
}

function showFirstTimeProfileSetup() {
  if (document.getElementById('profile-picker')) return;
  const overlay = document.createElement('div');
  overlay.id = 'profile-picker';
  overlay.innerHTML = `<div class="profile-picker-container">
    <h1>Welcome to ClaudeGPT</h1>
    <p class="profile-subtitle">Create your profile to get started.</p>
    <div class="profile-create">
      <input type="text" id="new-profile-name" placeholder="Your name..." maxlength="40" autofocus />
      <button id="create-profile-btn" class="onboarding-btn primary">Create</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  const nameInput = document.getElementById('new-profile-name');
  const doCreate = () => { const n = nameInput.value.trim(); if (n) send({ type: 'create_profile', name: n }); };
  document.getElementById('create-profile-btn').addEventListener('click', doCreate);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
}

export function renderProfileDropdown() {
  const dropdown = document.getElementById('profile-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = `
    ${state.cachedProfiles.map(p => `
      <div class="dropdown-profile ${p.name === state.cachedActiveProfile ? 'active' : ''}" data-name="${escapeHtml(p.name)}">
        <span>${escapeHtml(p.name)}</span>
        <span class="dp-actions">
          ${p.name === state.cachedActiveProfile ? '<span class="dp-status">active</span>' : ''}
          <span class="dp-delete" data-name="${escapeHtml(p.name)}" title="Delete profile">&times;</span>
        </span>
      </div>
    `).join('')}
    <div class="dropdown-divider"></div>
    <div class="dropdown-create">
      <input type="text" id="dropdown-new-name" placeholder="New profile..." maxlength="40" />
      <button id="dropdown-create-btn">+</button>
    </div>
  `;

  dropdown.querySelectorAll('.dropdown-profile').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.dp-delete')) return;
      e.stopPropagation();
      const name = el.dataset.name;
      if (name !== state.cachedActiveProfile) send({ type: 'select_profile', name });
      toggleProfileDropdown(false);
    });
  });

  dropdown.querySelectorAll('.dp-delete').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = el.dataset.name;
      if (confirm(`Delete profile "${name}"? This will permanently remove all their KB data.`)) {
        send({ type: 'delete_profile', name });
        toggleProfileDropdown(false);
      }
    });
  });

  const nameInput = document.getElementById('dropdown-new-name');
  const createBtn = document.getElementById('dropdown-create-btn');
  const doCreate = () => { const n = nameInput.value.trim(); if (n) { send({ type: 'create_profile', name: n }); toggleProfileDropdown(false); } };
  createBtn.addEventListener('click', (e) => { e.stopPropagation(); doCreate(); });
  nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') doCreate(); });
  nameInput.addEventListener('click', (e) => e.stopPropagation());
}

export function toggleProfileDropdown(forceState) {
  const dropdown = document.getElementById('profile-dropdown');
  if (!dropdown) return;
  state.profileDropdownOpen = forceState !== undefined ? forceState : !state.profileDropdownOpen;
  dropdown.classList.toggle('hidden', !state.profileDropdownOpen);
  if (state.profileDropdownOpen) renderProfileDropdown();
}

export function setupProfileListeners() {
  document.getElementById('profile-switcher').addEventListener('click', (e) => {
    if (e.target.closest('#profile-dropdown')) return;
    e.stopPropagation();
    toggleProfileDropdown();
  });

  document.addEventListener('click', (e) => {
    if (state.profileDropdownOpen && !e.target.closest('#profile-switcher')) toggleProfileDropdown(false);
  });
}
