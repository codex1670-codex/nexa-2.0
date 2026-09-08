import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import PostCard from '../components/PostCard.jsx';
import { useAuth } from '../AuthContext.jsx';

export default function Profile({ username, onOpenMessage, onOpenSettings }) {
  const { user: me } = useAuth();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [status, setStatus] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [savedPosts, setSavedPosts] = useState(null);

  useEffect(() => {
    setProfile(null);
    setError('');
    setMenuOpen(false);
    setShowSaved(false);
    api.getUser(username).then(res => setProfile(res.user)).catch(err => setError(err.message));
  }, [username]);

  const toggleFollow = async () => {
    setBusy(true);
    try {
      const res = profile.isFollowing ? await api.unfollow(username) : await api.follow(username);
      setProfile(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doAction = async (action) => {
    setMenuOpen(false);
    try {
      if (action === 'mute') { await api.mute(username); setMuted(true); setStatus(`Muted @${username}.`); }
      if (action === 'unmute') { await api.unmute(username); setMuted(false); setStatus(`Unmuted @${username}.`); }
      if (action === 'restrict') { await api.restrict(username); setRestricted(true); setStatus(`Restricted @${username}.`); }
      if (action === 'unrestrict') { await api.unrestrict(username); setRestricted(false); setStatus(`Unrestricted @${username}.`); }
      if (action === 'block') { await api.block(username); setStatus(`Blocked @${username}.`); }
      if (action === 'report') { await api.report('user', profile.id, 'Reported from profile'); setStatus('Reported — thanks for letting us know.'); }
    } catch (err) {
      setStatus(err.message);
    }
  };

  const openSaved = async () => {
    setShowSaved(true);
    if (!savedPosts) setSavedPosts((await api.savedPosts()).posts);
  };

  if (error) return <div className="empty-state">{error}</div>;
  if (!profile) return <div className="empty-state"><span className="loading-dot" /> Loading profile…</div>;

  return (
    <div>
      <div className="glass-card profile-header" style={{ position: 'relative' }}>
        <Avatar name={profile.displayName} color={profile.avatarColor} size={78} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600 }}>{profile.displayName}</div>
          <div style={{ color: 'var(--text-mid)', fontSize: 13.5 }}>@{profile.username}</div>
          {profile.bio && <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--text-hi)' }}>{profile.bio}</p>}
          <div className="profile-stats">
            <span><b>{profile.postCount}</b> posts</span>
            <span><b>{profile.followerCount}</b> followers</span>
            <span><b>{profile.followingCount}</b> following</span>
          </div>
        </div>
        {profile.isSelf ? (
          <button className="btn-ghost" onClick={onOpenSettings}>⚙ Settings</button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
            <button className="btn-ghost" style={{ background: profile.isFollowing ? 'transparent' : 'var(--violet)', borderColor: profile.isFollowing ? undefined : 'var(--violet)' }} disabled={busy} onClick={toggleFollow}>
              {profile.isFollowing ? 'Following' : 'Follow'}
            </button>
            <button className="btn-ghost" onClick={() => onOpenMessage(profile.username)}>Message</button>
            <button className="btn-ghost" onClick={() => setMenuOpen(o => !o)}>•••</button>
            {menuOpen && (
              <div className="glass-card" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, padding: 8, zIndex: 10, minWidth: 160 }}>
                <button className="nav-link" onClick={() => doAction(muted ? 'unmute' : 'mute')}>{muted ? 'Unmute' : 'Mute'}</button>
                <button className="nav-link" onClick={() => doAction(restricted ? 'unrestrict' : 'restrict')}>{restricted ? 'Unrestrict' : 'Restrict'}</button>
                <button className="nav-link" style={{ color: 'var(--pink)' }} onClick={() => doAction('block')}>Block</button>
                <button className="nav-link" onClick={() => doAction('report')}>Report</button>
              </div>
            )}
          </div>
        )}
      </div>

      {status && <div className="request-banner" style={{ marginBottom: 16 }}>{status}</div>}

      {profile.isSelf && (
        <div style={{ marginBottom: 16 }}>
          <button className="btn-ghost" onClick={openSaved}>{showSaved ? 'Hide saved' : '🔖 View saved posts'}</button>
        </div>
      )}

      {showSaved ? (
        <div>
          {savedPosts === null && <div className="empty-state"><span className="loading-dot" /></div>}
          {savedPosts?.length === 0 && <div className="empty-state">Nothing saved yet.</div>}
          {savedPosts?.map(p => <PostCard key={p.id} post={p} />)}
        </div>
      ) : (
        <div className="empty-state" style={{ color: 'var(--text-low)' }}>
          Post grid isn't part of this vertical slice — see the Home feed for @{profile.username}'s posts.
        </div>
      )}
    </div>
  );
}
