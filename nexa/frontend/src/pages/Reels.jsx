import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import { useAuth } from '../AuthContext.jsx';

function ReelCard({ reel }) {
  const { user } = useAuth();
  const [r, setR] = useState(reel);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [videoFailed, setVideoFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(reel.caption);
  const isMine = r.author.id === user.id;

  const toggleLike = async () => {
    const wasLiked = r.likedByMe;
    setR({ ...r, likedByMe: !wasLiked, likeCount: r.likeCount + (wasLiked ? -1 : 1) });
    try {
      const res = wasLiked ? await api.unlikeReel(r.id) : await api.likeReel(r.id);
      setR(res.reel);
    } catch { setR(r); }
  };

  const toggleSave = async () => {
    const wasSaved = r.savedByMe;
    setR({ ...r, savedByMe: !wasSaved });
    try { wasSaved ? await api.unsaveReel(r.id) : await api.saveReel(r.id); } catch { setR(r); }
  };

  const saveEdit = async () => {
    const res = await api.editReel(r.id, captionDraft.trim());
    setR(res.reel);
    setEditing(false);
  };

  const openComments = async () => {
    setShowComments(s => !s);
    if (!comments) setComments((await api.reelComments(r.id)).comments);
  };

  const submitComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    const res = await api.addReelComment(r.id, commentText.trim());
    setComments(c => [...(c || []), res.comment]);
    setCommentText('');
    setR({ ...r, commentCount: r.commentCount + 1 });
  };

  return (
    <div className="glass-card post-card">
      <div className="post-header">
        <Avatar name={r.author.displayName} color={r.author.avatarColor} size={38} />
        <div>
          <div className="name">{r.author.displayName}</div>
          <div className="time">@{r.author.username}{r.editedAt && ' · edited'}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {isMine && <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setEditing(e => !e)}>Edit</button>}
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={toggleSave}>{r.savedByMe ? '🔖 Saved' : '🔖 Save'}</button>
        </div>
      </div>
      <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 12, background: 'rgba(255,255,255,0.03)', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!videoFailed ? (
          <video src={r.videoUrl} controls loop style={{ width: '100%', maxHeight: 420, display: 'block' }} onError={() => setVideoFailed(true)} />
        ) : (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-mid)', fontSize: 13 }}>
            Couldn't load this video URL — it may not be a directly playable file.
          </div>
        )}
      </div>
      {editing ? (
        <div style={{ marginBottom: 12 }}>
          <input value={captionDraft} onChange={e => setCaptionDraft(e.target.value)} maxLength={2200}
            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '9px 12px', color: 'var(--text-hi)', outline: 'none', fontSize: 14 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn-primary" style={{ width: 'auto', padding: '7px 16px' }} onClick={saveEdit}>Save</button>
            <button className="btn-ghost" onClick={() => { setEditing(false); setCaptionDraft(r.caption); }}>Cancel</button>
          </div>
        </div>
      ) : (
        r.caption && <p className="post-caption">{r.caption}</p>
      )}
      <div className="post-actions">
        <button className={r.likedByMe ? 'liked' : ''} onClick={toggleLike}>{r.likedByMe ? '♥' : '♡'} {r.likeCount}</button>
        <button onClick={openComments}>💬 {r.commentCount}</button>
      </div>
      {showComments && (
        <div className="comments-block">
          {(comments || []).map(c => (
            <div className="comment-row" key={c.id}><span className="b">{c.author.displayName}</span><span>{c.text}</span></div>
          ))}
          <form className="comment-input-row" onSubmit={submitComment}>
            <input placeholder="Add a comment…" value={commentText} onChange={e => setCommentText(e.target.value)} />
          </form>
        </div>
      )}
    </div>
  );
}

export default function Reels() {
  const [reels, setReels] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [composing, setComposing] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const res = await api.reelsFeed();
    setReels(res.reels);
    setCursor(res.nextCursor);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.createReel({ videoUrl: videoUrl.trim(), caption: caption.trim() });
      setReels(r => [res.reel, ...(r || [])]);
      setVideoUrl(''); setCaption(''); setComposing(false);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>Reels</h2>
        <button className="btn-ghost" onClick={() => setComposing(c => !c)}>{composing ? 'Cancel' : '+ New reel'}</button>
      </div>

      {composing && (
        <form className="glass-card composer" onSubmit={submit}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>Video URL (must be a direct .mp4/.webm/.mov link — no upload pipeline in this build)</label>
            <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://…/clip.mp4" />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>Caption</label>
            <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Say something about it…" />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 20px' }} type="submit">Post reel</button>
        </form>
      )}

      {reels === null && <div className="empty-state"><span className="loading-dot" /> Loading reels…</div>}
      {reels?.length === 0 && <div className="empty-state"><div className="glyph">🎬</div>No reels yet — be the first to post one.</div>}
      {reels?.map(r => <ReelCard key={r.id} reel={r} />)}
      {cursor && reels?.length > 0 && (
        <div style={{ textAlign: 'center' }}>
          <button className="btn-ghost" onClick={async () => {
            const res = await api.reelsFeed(cursor);
            setReels(r => [...r, ...res.reels]);
            setCursor(res.nextCursor);
          }}>Load more</button>
        </div>
      )}
    </div>
  );
}
