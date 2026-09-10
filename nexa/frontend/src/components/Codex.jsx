import { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';
import { requestStartCall } from '../callBus.js';

// Codex action registry for this vertical slice.
// Only these actions exist; every one calls the real backend and reports the real result.
// Anything outside this registry (games, media editing) is explicitly out of scope for
// this slice and Codex says so rather than pretending to do it.
const HELP = `I can help with things NEXA's backend actually supports right now:
• "message rahul: hey there" — send a message (or a message request if they haven't accepted you yet)
• "follow priya" / "unfollow priya"
• "go to priya's profile" / "open feed" / "open messages"
• "call rahul" / "video call rahul" — starts a real call if you already have a conversation with them
• "open spotify" / "open youtube and search AI tutorials" — opens the real web app in a new tab
Media editing and games-via-Codex aren't wired up in this slice, so I won't pretend to do those.`;

async function runCommand(raw, { navigate, currentUser }) {
  const text = raw.trim();
  const lower = text.toLowerCase();

  let m = lower.match(/^message\s+@?(\w+)[:,]?\s*(.*)$/) || lower.match(/^(?:send|dm)\s+@?(\w+)\s+(.*)$/);
  if (m) {
    const [, username, rest] = m;
    const body = text.slice(text.toLowerCase().indexOf(rest)).trim() || rest;
    if (!body) return { ok: false, text: `What should I say to @${username}?` };
    if (username === currentUser?.username) return { ok: false, text: "You can't message yourself." };
    try {
      const res = await api.sendMessage({ toUsername: username, text: body });
      if (res.status === 'sent') return { ok: true, text: `Sent to @${username}.`, navigate: () => navigate('messages', username) };
      return { ok: true, text: res.message, navigate: () => navigate('messages', username) };
    } catch (err) {
      return { ok: false, text: `Couldn't message @${username}: ${err.message}` };
    }
  }

  m = lower.match(/^(follow|unfollow)\s+@?(\w+)$/);
  if (m) {
    const [, action, username] = m;
    try {
      const res = action === 'follow' ? await api.follow(username) : await api.unfollow(username);
      return { ok: true, text: `${action === 'follow' ? 'Followed' : 'Unfollowed'} @${res.user.username}.`, navigate: () => navigate('profile', username) };
    } catch (err) {
      return { ok: false, text: `Couldn't ${action} @${username}: ${err.message}` };
    }
  }

  m = lower.match(/^(?:go to|open)\s+@?(\w+)(?:'s)?\s+profile$/);
  if (m) {
    const username = m[1];
    return { ok: true, text: `Opening @${username}'s profile.`, navigate: () => navigate('profile', username) };
  }

  if (/^open feed$|^go home$|^show (my )?feed$/.test(lower)) {
    return { ok: true, text: 'Opening your feed.', navigate: () => navigate('feed') };
  }
  if (/^open messages$/.test(lower)) {
    return { ok: true, text: 'Opening messages.', navigate: () => navigate('messages') };
  }

  m = lower.match(/^(video call|call)\s+@?(\w+)$/);
  if (m) {
    const [, kind, username] = m;
    const type = kind === 'video call' ? 'video' : 'voice';
    try {
      const convos = await api.conversations();
      const convo = convos.conversations.find(c => c.participants.some(p => p.username === username));
      if (!convo) return { ok: false, text: `You don't have a conversation with @${username} yet, so I can't start a call. Message them first.` };
      requestStartCall(convo.id, type);
      return { ok: true, text: `Starting a ${type} call with @${username}…`, navigate: () => navigate('messages', username) };
    } catch (err) {
      return { ok: false, text: `Couldn't start the call: ${err.message}` };
    }
  }

  m = lower.match(/^open\s+([a-z0-9 ]+?)(?:\s+and\s+search\s+(.+))?$/);
  if (m) {
    const [, appQuery, searchFor] = m;
    try {
      const res = await api.resolveApp(appQuery.trim(), searchFor);
      if (!res.resolved) return { ok: false, text: res.message };
      if (!res.launchable) return { ok: false, text: res.message };
      window.open(res.url, '_blank', 'noopener');
      return { ok: true, text: `Opening ${res.app.displayName}${searchFor ? ` and searching "${searchFor}"` : ''}…` };
    } catch (err) {
      return { ok: false, text: `Couldn't resolve that app: ${err.message}` };
    }
  }

  return { ok: false, text: "I didn't recognize that. Type \"help\" to see what I can actually do." };
}

export default function Codex({ navigate, currentUser }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState([{ who: 'codex', text: "Hi, I'm Codex. Try: \"follow priya\" or \"message rahul: hey!\", or tap 🎙 to talk to me." }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(null);
  const [listening, setListening] = useState(false);
  const [voiceOutOn, setVoiceOutOn] = useState(false);
  const [voiceLang, setVoiceLang] = useState('en-US');
  const logRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);
  useEffect(() => { api.codexStatus().then(r => setAiConfigured(r.configured)).catch(() => setAiConfigured(false)); }, []);

  const speak = (text) => {
    if (!voiceOutOn || !window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = voiceLang;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  const runText = async (text) => {
    setLog(l => [...l, { who: 'user', text }]);
    if (text.toLowerCase() === 'help') {
      setLog(l => [...l, { who: 'codex', text: HELP }]);
      speak(HELP);
      return;
    }
    setBusy(true);
    if (aiConfigured) {
      try {
        const res = await api.codexAct(text, { screen: 'app' });
        if (res.handled) {
          setLog(l => [...l, { who: 'codex', text: res.message }]);
          speak(res.message);
          if (res.navigate) navigate(res.navigate.screen, res.navigate);
          if (res.openUrl) window.open(res.openUrl, '_blank', 'noopener');
          if (res.startCall) requestStartCall(res.startCall.conversationId, res.startCall.type);
          setBusy(false);
          return;
        }
        setLog(l => [...l, { who: 'codex', text: res.message }]);
        speak(res.message);
        setBusy(false);
        return;
      } catch {
        // fall through to local parser below
      }
    }
    const result = await runCommand(text, { navigate, currentUser });
    setLog(l => [...l, { who: 'codex', text: result.text }]);
    speak(result.text);
    result.navigate?.();
    setBusy(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    await runText(text);
  };

  const SpeechRecognitionCtor = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggleListening = () => {
    if (!SpeechRecognitionCtor) {
      setLog(l => [...l, { who: 'codex', text: "Your browser doesn't support speech recognition (Chrome/Edge do). You can still type." }]);
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = voiceLang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setVoiceOutOn(true); // once you talk to Codex, it talks back
      runText(transcript);
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <>
      <button className="codex-fab" onClick={() => setOpen(o => !o)} aria-label="Codex">
        {open ? '✕' : '✦'}
      </button>
      {open && (
        <div className="glass-card codex-panel">
          <div className="codex-panel-header">
            <span className="t">Codex</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={voiceLang} onChange={e => setVoiceLang(e.target.value)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-soft)', borderRadius: 6, color: 'var(--text-mid)', fontSize: 11 }}>
                <option value="en-US">EN</option>
                <option value="ta-IN">TA</option>
                <option value="hi-IN">HI</option>
                <option value="es-ES">ES</option>
                <option value="fr-FR">FR</option>
              </select>
              <button onClick={() => setVoiceOutOn(v => !v)} title="Toggle spoken replies" style={{ opacity: voiceOutOn ? 1 : 0.4 }}>🔊</button>
              <button onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          <div className="codex-log" ref={logRef}>
            {log.map((m, i) => (
              <div key={i} className={`codex-msg ${m.who}`}>
                <span className="who">{m.who === 'codex' ? 'Codex' : 'You'}</span>
                {m.text}
              </div>
            ))}
            {busy && <div className="codex-msg codex"><span className="loading-dot" /></div>}
          </div>
          <div className="codex-hint">
            {aiConfigured === null ? 'Checking AI availability…' : aiConfigured
              ? 'AI-powered — understands natural phrasing, any language.'
              : 'Basic pattern matching only — set ANTHROPIC_API_KEY on the server for full AI understanding.'}
          </div>
          <form className="codex-input-row" onSubmit={submit}>
            <button type="button" onClick={toggleListening} style={{ background: listening ? 'var(--pink)' : 'transparent', border: '1px solid var(--border-soft)', borderRadius: '50%', width: 34, height: 34, color: 'white', cursor: 'pointer', flexShrink: 0 }}>
              {listening ? '⏹' : '🎙'}
            </button>
            <input placeholder={listening ? 'Listening…' : 'Tell Codex what to do…'} value={input} onChange={e => setInput(e.target.value)} />
          </form>
        </div>
      )}
    </>
  );
}
