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
  chatgptImported: true, // assume true until server says otherwise
  liveTreePaths: new Set(),
  triageItems: [],
  triageDecisions: {},
  triageAskItems: {},
  triageSummarized: 0,
  triageTotal: 0,
  toolActions: [],
  selectedModel: 'sonnet',
  cachedProfiles: [],
  cachedActiveProfile: null,
  profileDropdownOpen: false,
  // Collections
  collectionSession: null,
  collectionsList: [],
  activeCollection: null,
  collectionProgress: { phase: null, currentFile: 0, totalFiles: 0 },
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
};
