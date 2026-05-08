const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function deslugify(slug) {
  return slug.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-?/, '').replace(/-/g, ' ');
}

function titleCase(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }
function extractFilename(p) { return (p.split('/').pop() || '').replace(/\.md$/, ''); }

function formatDate(p) {
  const m = p.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${MONTHS[parseInt(m[2], 10) - 1] || ''} ${parseInt(m[3], 10)}`;
}

export function humanizePath(p) {
  if (!p) return '';
  const rel = p;

  const map = {
    'now.md': 'current state',
    'understanding/psyche': 'psychological profile',
    'understanding/body': 'body awareness',
    'understanding/personality': 'personality profile',
    'understanding/values': 'values',
    'understanding/memory-map': 'memory map',
    'understanding/summary': 'summary',
    'understanding/interests': 'interests',
    'understanding/changelog': 'changelog',
    'understanding/negative-space': 'negative space',
    'understanding/cross-reference': 'cross-reference analysis',
    'understanding/patterns/index': 'patterns index',
    'understanding/insights/index': 'insights index',
    'active/open-threads': 'open threads',
  };

  for (const [key, label] of Object.entries(map)) {
    if (rel === key || rel.includes(key)) return label;
  }

  if (rel.includes('understanding/patterns/') || rel.includes('understanding/insights/'))
    return deslugify(extractFilename(rel));
  if (rel.includes('world/people/')) return titleCase(deslugify(extractFilename(rel)));
  if (rel.includes('world/')) return deslugify(extractFilename(rel));
  if (rel.includes('record/journal/')) { const d = formatDate(rel); return d ? `journal (${d})` : 'journal'; }
  if (rel.includes('record/moments/')) { const s = deslugify(extractFilename(rel)); return s ? `moment: ${s}` : 'moment'; }
  if (rel.includes('record/dreams/')) { const d = formatDate(rel); return d ? `dream (${d})` : 'dream'; }
  if (rel.includes('record/creative/')) return deslugify(extractFilename(rel));
  if (rel.includes('active/decisions/')) { const n = extractFilename(rel); return n === 'log' ? 'decisions log' : deslugify(n); }
  if (rel.includes('active/goals/') || rel.includes('active/limitations/'))
    return deslugify(extractFilename(rel));

  return deslugify(extractFilename(rel)) || rel;
}

export function humanizeToolName(name, input) {
  const names = { Read: 'Reading', Write: 'Writing', Edit: 'Updating', Grep: 'Searching', Glob: 'Scanning', WebSearch: 'Searching web', TodoWrite: 'Tracking' };
  if (names[name]) return names[name];
  if (name === 'Bash') {
    const cmd = (input && input.command) || '';
    if (cmd.includes('kb-search')) return 'Searching';
    if (cmd.includes('ls ')) return 'Checking';
    return 'Running';
  }
  return name;
}

export function extractToolDetail(name, input, repoDir) {
  if (!input) return '';
  const shortPath = (p) => p ? p.replace(repoDir + '/', '') : '';

  switch (name) {
    case 'Read': case 'Write': case 'Edit':
      return humanizePath(shortPath(input.file_path));
    case 'Bash': {
      const cmd = input.command || '';
      const searchMatch = cmd.match(/kb-search\s+"([^"]+)"/);
      if (searchMatch) { const q = searchMatch[1]; return q.length > 55 ? `"${q.slice(0, 52)}..."` : `"${q}"`; }
      if (cmd.includes('ls ')) return 'files';
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
    case 'Glob': return input.pattern || '';
    case 'Grep': case 'WebSearch': {
      const q = input.pattern || input.query || '';
      return q.length > 50 ? `"${q.slice(0, 47)}..."` : `"${q}"`;
    }
    default: return '';
  }
}
