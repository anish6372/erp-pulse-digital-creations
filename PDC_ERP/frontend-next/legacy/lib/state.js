// sessionStorage, not localStorage: the token should NOT survive closing the browser/tab -
// closing without an explicit logout must still require a fresh login next time, not
// silently resume the old session. sessionStorage does exactly that (cleared on close) while
// still surviving an ordinary page refresh within the same browser session.
export const state = {
  token: typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pdc_token') || '' : '',
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
  if (token) sessionStorage.setItem('pdc_token', token);
  else sessionStorage.removeItem('pdc_token');
}
