export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

export function linkifyKbPaths(html) {
  return html.replace(/(?:`)?(user\/[\w\-\.\/]+\.[\w]+)(?:`)?/g, (match, filepath) => {
    const relPath = filepath.replace(/^user\//, '');
    return `<a class="kb-link" href="#" data-path="${relPath}" title="Open in explorer">${filepath}</a>`;
  });
}

export function scrollToBottom() {
  const messages = document.getElementById('messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}
