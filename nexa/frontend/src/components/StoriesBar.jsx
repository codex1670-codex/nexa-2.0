import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { useAuth } from '../AuthContext.jsx';
import StoryViewer from './StoryViewer.jsx';

export default function StoriesBar() {
  const { user } = useAuth();
  const [groups, setGroups] = useState(null);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState('everyone');
  const [viewingGroup, setViewingGroup] = useState(null);

  const load = () => api.storiesFeed().then(res => setGroups(res.groups));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await api.createStory({ mediaType: 'text', content: text.trim(), audience, background: '#7C5CFF' });
    setText('');
    setComposing(false);
    load();
  };

  if (groups === null) return null;
  const myGroup = groups.find(g => g.author.id === user.id);

  return (
    <>
      <div className="notes-row">
        <div className="note-card" onClick={() => setComposing(true)}>
          <div className="note-avatar-ring" style={{ background: myGroup ? 'linear-gradient(135deg, var(--violet), var(--pink))' : 'rgba(255,255,255,0.1)' }}>
            <Avatar name={user.displayName} color={user.avatarColor} size={52} />
          </div>
          <div className="label">{myGroup ? 'Your story' : 'Add story'}</div>
        </div>
        {groups.filter(g => g.author.id !== user.id).map(g => (
          <div className="note-card" key={g.author.id} onClick={() => setViewingGroup(g)}>
            <div className="note-avatar-ring">
              <Avatar name={g.author.displayName} color={g.author.avatarColor} size={52} />
            </div>
            <div className="label">{g.author.displayName}</div>
          </div>
        ))}
        {myGroup && (
          <div className="note-card" onClick={() => setViewingGroup(myGroup)}>
            <div className="note-avatar-ring"><Avatar name={user.displayName} color={user.avatarColor} size={52} /></div>
            <div className="label">View yours</div>
          </div>
        )}
      </div>

      {composing && (
        <form className="glass-card" style={{ padding: 16, marginBottom: 16 }} onSubmit={submit}>
          <textarea
            placeholder="What's your story?" value={text} maxLength={200}
            onChange={e => setText(e.target.value)}
            style={{ width: '100%', minHeight: 60, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: 10, color: 'var(--text-hi)', outline: 'none', fontSize: 14, marginBottom: 10, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {['everyone', 'followers', 'close_friends'].map(a => (
              <button key={a} type="button" onClick={() => setAudience(a)}
                style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, border: '1px solid var(--border-soft)', background: audience === a ? 'var(--violet)' : 'transparent', color: audience === a ? 'white' : 'var(--text-mid)', cursor: 'pointer' }}>
                {a.replace('_', ' ')}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" style={{ width: 'auto', padding: '8px 18px' }} type="submit">Share to story</button>
            <button type="button" className="btn-ghost" onClick={() => setComposing(false)}>Cancel</button>
          </div>
        </form>
      )}

      {viewingGroup && (
        <StoryViewer group={viewingGroup} isMine={viewingGroup.author.id === user.id} onClose={() => { setViewingGroup(null); load(); }} />
      )}
    </>
  );
}
