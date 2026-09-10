const BASE = '/api';

let accessToken = null;
let refreshToken = null;
let onAuthLost = () => {};

export function setTokens(tokens) {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  if (accessToken) localStorage.setItem('nexa_refresh', refreshToken || '');
  else localStorage.removeItem('nexa_refresh');
}

export function getAccessToken() { return accessToken; }
export function getStoredRefreshToken() { return localStorage.getItem('nexa_refresh'); }
export function onAuthFailure(fn) { onAuthLost = fn; }

async function request(path, { method = 'GET', body, retry = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && getStoredRefreshToken()) {
    const refreshed = await tryRefresh();
    if (refreshed) return request(path, { method, body, retry: false });
    onAuthLost();
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'Something went wrong.');
    err.code = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function tryRefresh() {
  try {
    const res = await fetch(BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: getStoredRefreshToken() }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  signup: (payload) => request('/auth/signup', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  logout: () => request('/auth/logout', { method: 'POST', body: { refreshToken: getStoredRefreshToken() } }),
  me: () => request('/auth/me'),

  getUser: (username) => request(`/users/${username}`),
  updateMe: (payload) => request('/users/me', { method: 'PATCH', body: payload }),
  follow: (username) => request(`/users/${username}/follow`, { method: 'POST' }),
  unfollow: (username) => request(`/users/${username}/follow`, { method: 'DELETE' }),
  searchUsers: (q) => request(`/users?q=${encodeURIComponent(q)}`),

  createPost: (payload) => request('/posts', { method: 'POST', body: payload }),
  editPost: (id, caption) => request(`/posts/${id}`, { method: 'PATCH', body: { caption } }),
  like: (id) => request(`/posts/${id}/like`, { method: 'POST' }),
  unlike: (id) => request(`/posts/${id}/like`, { method: 'DELETE' }),
  getComments: (id) => request(`/posts/${id}/comments`),
  addComment: (id, text, parentCommentId) => request(`/posts/${id}/comments`, { method: 'POST', body: { text, parentCommentId } }),
  editComment: (postId, commentId, text) => request(`/posts/${postId}/comments/${commentId}`, { method: 'PATCH', body: { text } }),
  deleteComment: (postId, commentId) => request(`/posts/${postId}/comments/${commentId}`, { method: 'DELETE' }),
  hideComment: (postId, commentId) => request(`/posts/${postId}/comments/${commentId}/hide`, { method: 'POST' }),
  unhideComment: (postId, commentId) => request(`/posts/${postId}/comments/${commentId}/hide`, { method: 'DELETE' }),

  feedFollowing: (cursor) => request(`/feed/following${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  feedForYou: (cursor) => request(`/feed/foryou${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),

  conversations: () => request('/messages/conversations'),
  conversationMessages: (id) => request(`/messages/conversations/${id}/messages`),
  sendMessage: (payload) => request('/messages/send', { method: 'POST', body: payload }),
  requests: () => request('/messages/requests'),
  acceptRequest: (id) => request(`/messages/requests/${id}/accept`, { method: 'POST' }),
  deleteRequest: (id) => request(`/messages/requests/${id}/delete`, { method: 'POST' }),
  blockRequest: (id) => request(`/messages/requests/${id}/block`, { method: 'POST' }),
  reportRequest: (id) => request(`/messages/requests/${id}/report`, { method: 'POST' }),

  notifications: () => request('/notifications'),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),

  notesFeed: () => request('/notes/feed'),
  createNote: (payload) => request('/notes', { method: 'POST', body: payload }),
  editNote: (payload) => request('/notes/mine', { method: 'PATCH', body: payload }),
  deleteMyNote: () => request('/notes/mine', { method: 'DELETE' }),
  likeNote: (id) => request(`/notes/${id}/like`, { method: 'POST' }),
  unlikeNote: (id) => request(`/notes/${id}/like`, { method: 'DELETE' }),
  replyNote: (id, text) => request(`/notes/${id}/reply`, { method: 'POST', body: { text } }),

  storiesFeed: () => request('/stories/feed'),
  createStory: (payload) => request('/stories', { method: 'POST', body: payload }),
  getStory: (id) => request(`/stories/${id}`),
  storyViewers: (id) => request(`/stories/${id}/viewers`),
  deleteStory: (id) => request(`/stories/${id}`, { method: 'DELETE' }),

  reelsFeed: (cursor) => request(`/reels/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  createReel: (payload) => request('/reels', { method: 'POST', body: payload }),
  editReel: (id, caption) => request(`/reels/${id}`, { method: 'PATCH', body: { caption } }),
  likeReel: (id) => request(`/reels/${id}/like`, { method: 'POST' }),
  unlikeReel: (id) => request(`/reels/${id}/like`, { method: 'DELETE' }),
  reelComments: (id) => request(`/reels/${id}/comments`),
  addReelComment: (id, text) => request(`/reels/${id}/comments`, { method: 'POST', body: { text } }),

  games: () => request('/games'),
  myGameRooms: () => request('/games/rooms/mine'),
  friendsGameRooms: () => request('/games/rooms/friends'),
  createGameRoom: (gameId) => request('/games/rooms', { method: 'POST', body: { gameId } }),
  joinGameRoom: (inviteCode) => request('/games/rooms/join', { method: 'POST', body: { inviteCode } }),
  getGameRoom: (id) => request(`/games/rooms/${id}`),
  inviteToGameRoom: (roomId, toUsername) => request(`/games/rooms/${roomId}/invite`, { method: 'POST', body: { toUsername } }),

  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),
  hashtagPosts: (tag) => request(`/search/hashtags/${encodeURIComponent(tag)}`),

  mute: (username) => request(`/users/${username}/mute`, { method: 'POST' }),
  unmute: (username) => request(`/users/${username}/mute`, { method: 'DELETE' }),
  restrict: (username) => request(`/users/${username}/restrict`, { method: 'POST' }),
  unrestrict: (username) => request(`/users/${username}/restrict`, { method: 'DELETE' }),
  block: (username) => request(`/users/${username}/block`, { method: 'POST' }),
  unblock: (username) => request(`/users/${username}/block`, { method: 'DELETE' }),

  savePost: (id) => request(`/posts/${id}/save`, { method: 'POST' }),
  unsavePost: (id) => request(`/posts/${id}/save`, { method: 'DELETE' }),
  savedPosts: () => request('/posts/saved/mine'),
  saveReel: (id) => request(`/reels/${id}/save`, { method: 'POST' }),
  unsaveReel: (id) => request(`/reels/${id}/save`, { method: 'DELETE' }),
  savedReels: () => request('/reels/saved/mine'),

  report: (targetType, targetId, reason) => request('/reports', { method: 'POST', body: { targetType, targetId, reason } }),

  reactMessage: (id, emoji) => request(`/messages/${id}/react`, { method: 'POST', body: { emoji } }),
  unreactMessage: (id) => request(`/messages/${id}/react`, { method: 'DELETE' }),
  editMessage: (id, content) => request(`/messages/${id}`, { method: 'PATCH', body: { content } }),
  deleteMessage: (id) => request(`/messages/${id}`, { method: 'DELETE' }),
  pinMessage: (id) => request(`/messages/${id}/pin`, { method: 'POST' }),
  unpinMessage: (id) => request(`/messages/${id}/pin`, { method: 'DELETE' }),
  pinnedMessages: (conversationId) => request(`/messages/conversations/${conversationId}/pinned`),
  forwardMessage: (id, payload) => request(`/messages/${id}/forward`, { method: 'POST', body: payload }),
  createGroup: (name, usernames) => request('/messages/conversations/group', { method: 'POST', body: { name, usernames } }),
  getChatTheme: () => request('/messages/theme'),
  setChatTheme: (theme) => request('/messages/theme', { method: 'POST', body: { theme } }),

  resolveApp: (query, searchFor) => request('/apps/resolve', { method: 'POST', body: { query, searchFor } }),
  listApps: () => request('/apps'),

  callHistory: () => request('/calls/history'),

  setup2FA: () => request('/auth/2fa/setup', { method: 'POST' }),
  enable2FA: (totpCode) => request('/auth/2fa/enable', { method: 'POST', body: { totpCode } }),
  disable2FA: (password) => request('/auth/2fa/disable', { method: 'POST', body: { password } }),
  deactivateAccount: () => request('/auth/deactivate', { method: 'POST' }),
  requestDeletion: (password, reason) => request('/auth/delete-request', { method: 'POST', body: { password, reason } }),
  cancelDeletion: () => request('/auth/delete-cancel', { method: 'POST' }),

  bioAI: (action, currentBio, targetLanguage) => request('/users/me/bio/ai', { method: 'POST', body: { action, currentBio, targetLanguage } }),

  codexStatus: () => request('/codex/status'),
  codexAct: (text, context) => request('/codex/act', { method: 'POST', body: { text, context } }),
  codexHistory: () => request('/codex/history'),

  gamesFriendsRooms: () => request('/games/rooms/friends'),
  inviteToGameRoom: (roomId, toUsername) => request(`/games/rooms/${roomId}/invite`, { method: 'POST', body: { toUsername } }),

  createTournament: (gameId, name) => request('/tournaments', { method: 'POST', body: { gameId, name } }),
  openTournaments: () => request('/tournaments/open'),
  myTournaments: () => request('/tournaments/mine'),
  getTournament: (id) => request(`/tournaments/${id}`),
  joinTournament: (id) => request(`/tournaments/${id}/join`, { method: 'POST' }),
  startTournament: (id) => request(`/tournaments/${id}/start`, { method: 'POST' }),
};
