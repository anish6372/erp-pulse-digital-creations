export const state = {
  token: localStorage.getItem('pdc_token') || '',
  me: null,
  boot: null,
  currentPage: 'dashboard',
  selectedChatId: null,
  selectedGroupId: null,
  chatMode: 'direct', // 'direct' | 'group'
  timer: null,
  onlineUsers: new Set(),
  lastSeen: {},
};

export function setToken(token) {
  state.token = token;
  if (token) localStorage.setItem('pdc_token', token);
  else localStorage.removeItem('pdc_token');
}
