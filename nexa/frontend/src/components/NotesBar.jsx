import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { useAuth } from '../AuthContext.jsx';

export default function NotesBar({ onOpenMessage }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState(null);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState('💭');
  const [expanded, setExpanded] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [status, setStatus] = useState('');

  const load = () => api.notesFeed().then(res => setNotes(res.notes));
  useEffect(() => { load(); }, []);

  const myNote = notes?.find(n => n.author.id === user.id);
  const others = notes?.filter(n => n.author.id !== user.id) || [];

  const openComposer = () => {
    if (myNote) { setText(myNote.text || ''); setEmoji(myNote.emoji || '💭'); }
    setComposing(true);
  };

  const submitNote = async (e) => {
    e.preventDefault();
    if (!text.trim() && !emoji) return;
    if (myNote) {
      await api.editNote({ text: text.trim(), emoji });
    } else {
      await api.createNote({ text: text.trim(), emoji, audience: 'followers' });
    }
    setText('');
    setComposing(false);
    load();
  };

  const toggleLike = async (note) => {
    if (note.likedByMe) await api.unlikeNote(note.id); else await api.likeNote(note.id);
    load();
  };

  const sendReply = async (note) => {
    if (!replyText.trim()) return;
    const res = await api.replyNote(note.id, replyText.trim());
    setStatus(res.status === 'sent' ? 'Reply sent!' : res.message);
    setReplyText('');
  };

  if (notes === null) return null;

  return (
    <>
      <div className="notes-row">
        <div className="note-card" onClick={openComposer}>
          <div className="note-avatar-ring" style={{ background: myNote ? 'linear-gradient(135deg, var(--violet), var(--pink))' : 'rgba(255,255,255,0.1)' }}>
            <Avatar name={user.displayName} color={user.avatarColor} size={52} />
          </div>
          <div className="label">{myNote ? myNote.emoji + ' ' + (myNote.text || '') : 'Your note'}</div>
        </div>
        {others.map(n => (
          <div className="note-card" key={n.id} onClick={() => { setExpanded(n); setStatus(''); }}>
            <div className="note-avatar-ring">
              <Avatar name={n.author.displayName} color={n.author.avatarColor} size={52} />
            </div>
            <div className="label">{n.emoji} {n.text}</div>
          </div>
        ))}
      </div>

      {composing && (
        <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
          <form onSubmit={submitNote}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {['💭', '🎧', '☕', '😴', '🔥', '📚'].map(e => (
                <button key={e} type="button" onClick={() => setEmoji(e)}
                  style={{ fontSize: 20, background: emoji === e ? 'var(--surface-hover)' : 'transparent', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '4px 8px', cursor: 'pointer' }}>
                  {e}
                </button>
              ))}
            </div>
            <input
              placeholder="Share a thought (max 60 chars)…" value={text} maxLength={60}
              onChange={e => setText(e.target.value)}
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '9px 12px', color: 'var(--text-hi)', outline: 'none', fontSize: 13.5, marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ width: 'auto', padding: '8px 18px' }} type="submit">{myNote ? 'Save changes' : 'Share note'}</button>
              {myNote && <button type="button" className="btn-ghost" onClick={async () => { await api.deleteMyNote(); setComposing(false); load(); }}>Remove note</button>}
              <button type="button" className="btn-ghost" onClick={() => setComposing(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {expanded && (
        <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <Avatar name={expanded.author.displayName} color={expanded.author.avatarColor} size={36} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{expanded.author.displayName}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-mid)' }}>{expanded.emoji} {expanded.text}</div>
            </div>
            <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setExpanded(null)}>Close</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button className="btn-ghost" onClick={() => toggleLike(expanded)}>{expanded.likedByMe ? '♥ Liked' : '♡ Like'} ({expanded.likeCount})</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder={`Reply to ${expanded.author.displayName}…`} value={replyText} onChange={e => setReplyText(e.target.value)}
              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 999, padding: '9px 14px', color: 'var(--text-hi)', outline: 'none', fontSize: 13.5 }} />
            <button className="send-btn" onClick={() => sendReply(expanded)}>➤</button>
          </div>
          {status && <div className="request-banner" style={{ marginTop: 10 }}>{status}</div>}
          <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => onOpenMessage?.(expanded.author.username)}>Open conversation</button>
        </div>
      )}
    </>
  );
}
