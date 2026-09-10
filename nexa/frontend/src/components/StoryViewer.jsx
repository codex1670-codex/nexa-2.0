import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const DURATION_MS = 5000;

export default function StoryViewer({ group, isMine, onClose }) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState(null);
  const timerRef = useRef(null);
  const story = group.stories[index];

  useEffect(() => {
    api.getStory(story.id); // records the view server-side
    setViewers(null);
    setProgress(0);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / DURATION_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(timerRef.current);
        goNext();
      }
    }, 50);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line
  }, [index, story.id]);

  const goNext = () => {
    if (index < group.stories.length - 1) setIndex(i => i + 1);
    else onClose();
  };
  const goPrev = () => {
    if (index > 0) setIndex(i => i - 1);
  };

  const loadViewers = async () => {
    const res = await api.storyViewers(story.id);
    setViewers(res.viewers);
  };

  const remove = async () => {
    await api.deleteStory(story.id);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,4,10,0.92)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 340, maxWidth: '92vw', height: 560, maxHeight: '85vh', borderRadius: 20, overflow: 'hidden', position: 'relative', background: story.background || '#7C5CFF', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 4, padding: '10px 12px' }}>
          {group.stories.map((s, i) => (
            <div key={s.id} style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${i < index ? 100 : i === index ? progress : 0}%`, background: 'white', transition: 'width 0.1s linear' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 10px', color: 'white' }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{group.author.displayName}</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>{new Date(story.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative' }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width / 2) goPrev(); else goNext();
          }}
        >
          {story.mediaType === 'image'
            ? <img src={story.content} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
            : <div style={{ color: 'white', fontSize: 22, fontWeight: 600, textAlign: 'center', lineHeight: 1.4, fontFamily: 'var(--font-display)' }}>{story.content}</div>}
        </div>

        <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.8)' }}>{story.viewCount} view{story.viewCount === 1 ? '' : 's'}</div>
          {isMine && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={(e) => { e.stopPropagation(); loadViewers(); }}>Viewers</button>
              <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 10px', color: 'var(--pink)' }} onClick={(e) => { e.stopPropagation(); remove(); }}>Delete</button>
            </div>
          )}
        </div>

        {viewers && (
          <div style={{ position: 'absolute', bottom: 50, left: 0, right: 0, maxHeight: 160, overflowY: 'auto', background: 'rgba(10,8,18,0.95)', padding: 10 }}>
            {viewers.length === 0 && <div style={{ color: 'var(--text-low)', fontSize: 12.5 }}>No views yet.</div>}
            {viewers.map(v => (
              <div key={v.id} style={{ color: 'white', fontSize: 13, padding: '4px 0' }}>{v.displayName} · @{v.username}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
