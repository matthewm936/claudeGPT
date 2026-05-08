// Shared mutable state
export const state = {
  ws: null,
  currentConversationId: null,
  isStreaming: false,
  streamBuffer: '',
  renderTimer: null,
  openTabs: [],
  activeTabPath: null,
  sidebarCollapsed: false,
  explorerCollapsed: false,
  onboardingRequired: false,
  liveTreePaths: new Set(),
  triageItems: [],
  triageDecisions: {},
  triageAskItems: {},
  triageSummarized: 0,
  triageTotal: 0,
  toolActions: [],
  cachedProfiles: [],
  cachedActiveProfile: null,
  profileDropdownOpen: false,
  // Artifacts
  artifactSession: null,
  artifactsList: [],
  artifactProgress: { phase: null, currentPage: 0, totalPages: 0, anchorDates: [] },
};

// DOM refs
export const $ = (sel) => document.querySelector(sel);
export const dom = {
  app: $('#app'),
  sidebar: $('#sidebar'),
  explorerPanel: $('#explorer-panel'),
  convList: $('#conversation-list'),
  messages: $('#messages'),
  chatInput: $('#chat-input'),
  sendBtn: $('#send-btn'),
  fileTree: $('#file-tree'),
  fileTabs: $('#file-tabs'),
  fileViewer: $('#file-viewer'),
  inboxBadge: $('#inbox-badge'),
  inboxCount: $('#inbox-count'),
  dropOverlay: $('#drop-overlay'),
};
