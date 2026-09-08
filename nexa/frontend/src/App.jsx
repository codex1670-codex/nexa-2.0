import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import Auth from './pages/Auth.jsx';
import Feed from './pages/Feed.jsx';
import Profile from './pages/Profile.jsx';
import Messages from './pages/Messages.jsx';
import Reels from './pages/Reels.jsx';
import Notifications from './pages/Notifications.jsx';
import Games from './pages/Games.jsx';
import Search from './pages/Search.jsx';
import Settings from './pages/Settings.jsx';
import Avatar from './components/Avatar.jsx';
import Codex from './components/Codex.jsx';
import CallLayer from './components/CallLayer.jsx';
import { api } from './api.js';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';

const NAV = [
  { key: 'feed', label: 'Home', icon: '🏠' },
  { key: 'search', label: 'Search', icon: '🔍' },
  { key: 'reels', label: 'Reels', icon: '🎬' },
  { key: 'messages', label: 'Messages', icon: '💬' },
  { key: 'notifications', label: 'Notifications', icon: '🔔' },
  { key: 'games', label: 'Games', icon: '🎮' },
  { key: 'profile', label: 'Profile', icon: '👤' },
];

export default function App() {
  const { user, booting, logout } = useAuth();
  const [route, setRoute] = useState('feed');
  const [profileUsername, setProfileUsername] = useState(null);
  const [messageStart, setMessageStart] = useState(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    connectSocket();
    api.notifications().then(res => setUnread(res.unreadCount)).catch(() => {});
    const socket = getSocket();
    const onNotif = () => setUnread(u => u + 1);
    socket?.on('notification:new', onNotif);
    return () => {
      socket?.off('notification:new', onNotif);
      disconnectSocket();
    };
  }, [user]);

  if (booting) {
    return <div className="center-screen"><span className="loading-dot" /></div>;
  }
  if (!user) return <Auth />;

  const navigate = (key, param) => {
    if (key === 'profile') setProfileUsername(param || user.username);
    if (key === 'messages') setMessageStart(param || null);
    if (key === 'notifications') setUnread(0);
    setRoute(key);
  };
  const openSettings = () => setRoute('settings');

  return (
    <div className="app-shell">
      <nav className="nav-rail">
        <div className="nexa-wordmark">NEXA</div>
        {NAV.map(n => (
          <button
            key={n.key}
            className={`nav-link ${route === n.key ? 'active' : ''}`}
            onClick={() => navigate(n.key, n.key === 'profile' ? user.username : undefined)}
          >
            <span>{n.icon}</span> {n.label}
            {n.key === 'notifications' && unread > 0 && <span className="dot" />}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
          <Avatar name={user.displayName} color={user.avatarColor} size={32} />
          <div style={{ fontSize: 13, fontWeight: 500 }}>{user.displayName}</div>
        </div>
        <button className="nav-link" onClick={logout}>⏻ Log out</button>
      </nav>

      <main className="main-col">
        {route === 'feed' && <Feed onOpenProfile={(u) => navigate('profile', u)} />}
        {route === 'search' && <Search onOpenProfile={(u) => navigate('profile', u)} />}
        {route === 'reels' && <Reels />}
        {route === 'notifications' && <Notifications onOpenProfile={(u) => navigate('profile', u)} />}
        {route === 'games' && <Games />}
        {route === 'settings' && <Settings onBack={() => navigate('profile', user.username)} />}
        {route === 'profile' && (
          <Profile
            username={profileUsername || user.username}
            onOpenMessage={(u) => navigate('messages', u)}
            onOpenSettings={openSettings}
          />
        )}
        {route === 'messages' && (
          <Messages startWithUsername={messageStart} onConsumeStart={() => setMessageStart(null)} />
        )}
      </main>

      <div className="nav-bar-mobile">
        {NAV.map(n => (
          <button key={n.key} className={route === n.key ? 'active' : ''} onClick={() => navigate(n.key, n.key === 'profile' ? user.username : undefined)} style={{ position: 'relative' }}>
            {n.icon}
            {n.key === 'notifications' && unread > 0 && <span className="dot" style={{ position: 'absolute', top: 4, right: 10 }} />}
          </button>
        ))}
      </div>

      <Codex navigate={navigate} currentUser={user} />
      <CallLayer />
    </div>
  );
}
