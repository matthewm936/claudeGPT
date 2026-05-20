import { send } from './ws.js';

let pollTimer = null;
let setupOverlay = null;

/**
 * Handle claude_status message from server.
 * Shows setup overlay if not authenticated, hides it if authenticated.
 */
export function handleClaudeStatus(msg) {
  if (msg.authenticated) {
    hideSetup();
    return;
  }
  showSetup(msg);
}

function showSetup(status) {
  if (setupOverlay) return; // already showing

  setupOverlay = document.createElement('div');
  setupOverlay.id = 'setup-overlay';

  const notInstalled = !status.installed;
  const heading = notInstalled ? 'Claude Code not found' : 'Connect your Claude account';
  const desc = notInstalled
    ? 'YourPsyche needs Claude Code to work. Double-click <strong>setup.command</strong> first, then refresh this page.'
    : 'YourPsyche uses Claude as its brain. Sign in with your Anthropic account to get started.';
  const action = notInstalled
    ? '<button class="setup-btn secondary" onclick="location.reload()">Refresh</button>'
    : '<button class="setup-btn primary" id="setup-login-btn">Sign in with Claude</button>';
  const footer = notInstalled
    ? ''
    : '<p class="setup-footer">Need an account? <a href="https://claude.ai/pricing" target="_blank">claude.ai/pricing</a></p>';

  setupOverlay.innerHTML = `
    <div class="setup-card">
      <div class="setup-wordmark">YourPsyche</div>
      <h1 class="setup-heading">${heading}</h1>
      <p class="setup-desc">${desc}</p>
      <div class="setup-action">${action}</div>
      <div id="setup-waiting" class="setup-waiting hidden">
        <span class="pulse-dot"></span> Waiting for sign-in...
      </div>
      ${footer}
    </div>`;

  document.body.appendChild(setupOverlay);

  if (!notInstalled) {
    setupOverlay.querySelector('#setup-login-btn').addEventListener('click', startLogin);
  }
}

function startLogin() {
  send({ type: 'claude_login' });

  // Show waiting state
  const btn = document.getElementById('setup-login-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Opening sign-in...'; }
  const waiting = document.getElementById('setup-waiting');
  if (waiting) waiting.classList.remove('hidden');

  // Poll for auth completion every 3s
  pollTimer = setInterval(() => {
    send({ type: 'claude_check' });
  }, 3000);
}

function hideSetup() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (setupOverlay) {
    setupOverlay.classList.add('fading');
    setTimeout(() => { setupOverlay.remove(); setupOverlay = null; }, 400);
  }
}
