import { useState } from 'react';
import Avatar from './Avatar.jsx';
import { api } from '../api.js';

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function PostCard({ post, onOpenProfile }) {
  const [p, setP] = useState(post);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportStatus, setReportStatus] = useState('');

  const toggleLike = async () => {
    if (busy) return;
    setBusy(true);
    const wasLiked = p.likedByMe;
    setP({ ...p, likedByMe: !wasLiked, likeCount: p.likeCount + (wasLiked ? -1 : 1) }); // optimistic
    try {
      const res = wasLiked ? await api.unlike(p.id) : await api.like(p.id);
      setP(res.post);
    } catch {
      setP(p); // revert on failure — never claim a like that didn't actually happen
    } finally {
      setBusy(false);
    }
  };

  const openComments = async () => {
    setShowComments(s => !s);
    if (!comments) {
      const res = await api.getComments(p.id);
      setComments(res.comments);
    }
  };

  const submitComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    const res = await api.addComment(p.id, commentText.trim());
    setComments(c => [...(c || []), res.comment]);
    setCommentText('');
    setP({ ...p, commentCount: p.commentCount + 1 });
  };

  const toggleSave = async () => {
    const wasSaved = p.savedByMe;
    setP({ ...p, savedByMe: !wasSaved });
    try {
      wasSaved ? await api.unsavePost(p.id) : await api.savePost(p.id);
    } catch {
      setP(p);
    }
  };

  const reportPost = async () => {
    try {
      await api.report('post', p.id, 'Reported from feed');
      setReportStatus('Reported — thanks for letting us know.');
    } catch (err) {
      setReportStatus(err.message);
    }
  };

  return (
    <div className="glass-card post-card">
      <div className="post-header" onClick={() => onOpenProfile?.(p.author.username)} style={{ cursor: 'pointer' }}>
        <Avatar name={p.author.displayName} color={p.author.avatarColor} size={38} />
        <div>
          <div className="name">{p.author.displayName}</div>
          <div className="time">@{p.author.username} · {timeAgo(p.createdAt)}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={toggleSave}>{p.savedByMe ? '🔖 Saved' : '🔖 Save'}</button>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={reportPost}>Report</button>
        </div>
      </div>
      {reportStatus && <div className="request-banner" style={{ marginBottom: 10 }}>{reportStatus}</div>}
      {p.caption && <p className="post-caption">{p.caption}</p>}
      <div className="post-actions">
        <button className={p.likedByMe ? 'liked' : ''} onClick={toggleLike}>
          {p.likedByMe ? '♥' : '♡'} {p.likeCount}
        </button>
        <button onClick={openComments}>💬 {p.commentCount}</button>
      </div>
      {showComments && (
        <div className="comments-block">
          {(comments || []).map(c => (
            <div className="comment-row" key={c.id}>
              <span className="b">{c.author.displayName}</span>
              <span>{c.text}</span>
            </div>
          ))}
          {comments && comments.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-low)' }}>No comments yet.</div>
          )}
          <form className="comment-input-row" onSubmit={submitComment}>
            <input
              placeholder="Add a comment…"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
            />
          </form>
        </div>
      )}
    </div>
  );
}
