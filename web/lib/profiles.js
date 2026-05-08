import fs from 'fs';
import path from 'path';

let activeProfile = null;

function repoDir(profilesDir) { return path.dirname(profilesDir); }
function configPath(profilesDir) { return path.join(repoDir(profilesDir), '.active-profile'); }

function readConfig(profilesDir) {
  try { return fs.readFileSync(configPath(profilesDir), 'utf-8').trim() || null; }
  catch { return null; }
}

function writeConfig(profilesDir, name) {
  fs.writeFileSync(configPath(profilesDir), name + '\n');
}

export function init(profilesDir) {
  fs.mkdirSync(profilesDir, { recursive: true });

  // Config file is the source of truth
  const configured = readConfig(profilesDir);
  if (configured && fs.existsSync(path.join(profilesDir, configured))) {
    activeProfile = configured;
    return;
  }

  // Migration: check old symlink
  const userLink = path.join(repoDir(profilesDir), 'user');
  try {
    const stat = fs.lstatSync(userLink);
    if (stat.isSymbolicLink()) {
      const target = path.basename(fs.readlinkSync(userLink));
      if (fs.existsSync(path.join(profilesDir, target))) {
        activeProfile = target;
        writeConfig(profilesDir, target);
        return;
      }
    }
  } catch {}

  // Auto-select first profile if only one exists
  const profiles = list(profilesDir);
  if (profiles.length === 1) {
    select(profiles[0].name, profilesDir);
  }
}

export function list(profilesDir) {
  return fs.readdirSync(profilesDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => {
      const dir = path.join(profilesDir, e.name);
      const hasKB = fs.existsSync(path.join(dir, 'now.md'));
      const onboarded = fs.existsSync(path.join(dir, '.onboarding-complete')) || hasKB;
      return { name: e.name, hasKB, onboarded };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function create(name, profilesDir) {
  const safe = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40);
  if (!safe) throw new Error('Invalid profile name');
  const dir = path.join(profilesDir, safe);
  if (fs.existsSync(dir)) throw new Error('Profile already exists');
  fs.mkdirSync(dir, { recursive: true });
  return safe;
}

export function select(name, profilesDir) {
  const dir = path.join(profilesDir, name);
  if (!fs.existsSync(dir)) throw new Error('Profile not found');
  activeProfile = name;
  writeConfig(profilesDir, name);

  // Ensure inbox dirs exist
  const inboxRaw = path.join(dir, 'data', 'inbox', 'raw');
  const inboxProcessed = path.join(dir, 'data', 'inbox', 'processed');
  [inboxRaw, inboxProcessed].forEach(d => fs.mkdirSync(d, { recursive: true }));
  return name;
}

export function remove(name, profilesDir) {
  const dir = path.join(profilesDir, name);
  if (!fs.existsSync(dir)) throw new Error('Profile not found');
  fs.rmSync(dir, { recursive: true, force: true });

  if (activeProfile === name) {
    activeProfile = null;
    const remaining = list(profilesDir);
    if (remaining.length > 0) {
      select(remaining[0].name, profilesDir);
    } else {
      try { fs.unlinkSync(configPath(profilesDir)); } catch {}
    }
  }
}

export function getActive() { return activeProfile; }

export function getDir(profilesDir) {
  return activeProfile ? path.join(profilesDir, activeProfile) : null;
}

export function isOnboardingComplete(profilesDir) {
  const dir = getDir(profilesDir);
  if (!dir) return false;
  return fs.existsSync(path.join(dir, '.onboarding-complete')) || fs.existsSync(path.join(dir, 'now.md'));
}

export function markOnboardingComplete(profilesDir) {
  const dir = getDir(profilesDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.onboarding-complete'), new Date().toISOString());
}
