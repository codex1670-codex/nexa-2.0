import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

function BioAI() {
  const { user, setUser } = useAuth();
  const [bio, setBio] = useState(user.bio || '');
  const [suggestion, setSuggestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('Spanish');

  const run = async (action) => {
    setBusy(true);
    setError('');
    setSuggestion('');
    try {
      const res = await api.bioAI(action, bio, targetLanguage);
      setSuggestion(res.suggestion);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const acceptSuggestion = async () => {
    const res = await api.updateMe({ bio: suggestion });
    setUser(u => ({ ...u, bio: res.user.bio }));
    setBio(suggestion);
    setSuggestion('');
  };

  const saveBio = async () => {
    const res = await api.updateMe({ bio });
    setUser(u => ({ ...u, bio: res.user.bio }));
  };

  return (
    <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Bio</div>
      <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 10 }}>
        Codex can help write it — needs an ANTHROPIC_API_KEY configured on the server.
      </p>
      <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={300}
        style={{ width: '100%', minHeight: 70, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: 10, color: 'var(--text-hi)', outline: 'none', fontSize: 14, marginBottom: 10, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn-ghost" disabled={busy} onClick={() => run('write')}>✦ Write</button>
        <button className="btn-ghost" disabled={busy} onClick={() => run('improve')}>✦ Improve</button>
        <button className="btn-ghost" disabled={busy} onClick={() => run('professional')}>✦ Professional</button>
        <button className="btn-ghost" disabled={busy} onClick={() => run('shorter')}>✦ Shorter</button>
        <select value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 8, color: 'var(--text-hi)', fontSize: 12.5 }}>
          {['Spanish', 'French', 'Hindi', 'Tamil', 'Japanese', 'Arabic'].map(l => <option key={l}>{l}</option>)}
        </select>
        <button className="btn-ghost" disabled={busy} onClick={() => run('translate')}>✦ Translate</button>
      </div>
      {busy && <div style={{ fontSize: 13, color: 'var(--text-mid)' }}><span className="loading-dot" /> Thinking…</div>}
      {error && <div className="error-banner">{error}</div>}
      {suggestion && (
        <div className="request-banner" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>{suggestion}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={acceptSuggestion}>Use this</button>
            <button className="btn-ghost" onClick={() => setSuggestion('')}>Dismiss</button>
          </div>
        </div>
      )}
      <button className="btn-primary" style={{ width: 'auto', padding: '8px 18px', marginTop: 10 }} onClick={saveBio}>Save bio</button>
    </div>
  );
}

export default function Settings({ onBack }) {
  const { logout } = useAuth();
  const [setup, setSetup] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [deletion, setDeletion] = useState(null);

  const start2FASetup = async () => {
    setError('');
    try { setSetup(await api.setup2FA()); } catch (err) { setError(err.message); }
  };

  const enable2FA = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.enable2FA(totpCode.trim());
      setStatus('Two-factor authentication is now enabled.');
      setSetup(null);
      setTotpCode('');
    } catch (err) { setError(err.message); }
  };

  const disable2FA = async () => {
    setError('');
    try {
      await api.disable2FA(password);
      setStatus('Two-factor authentication disabled.');
      setPassword('');
    } catch (err) { setError(err.message); }
  };

  const deactivate = async () => {
    setError('');
    try {
      await api.deactivateAccount();
      await logout();
    } catch (err) { setError(err.message); }
  };

  const requestDelete = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.requestDeletion(password, reason);
      setDeletion(res.deletion);
      setStatus(res.message);
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <button className="btn-ghost" style={{ marginBottom: 16 }} onClick={onBack}>← Back to profile</button>
      <h2 className="page-title">Account Settings</h2>
      {status && <div className="request-banner" style={{ marginBottom: 16 }}>{status}</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Two-Factor Authentication</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>
          Adds a 6-digit authenticator code (TOTP) to login, on top of your password.
        </p>
        {!setup && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} onClick={start2FASetup}>Set up 2FA</button>
            <button className="btn-ghost" onClick={disable2FA}>Disable 2FA</button>
          </div>
        )}
        {setup && (
          <form onSubmit={enable2FA}>
            <p style={{ fontSize: 12.5, color: 'var(--text-mid)', wordBreak: 'break-all', marginBottom: 10 }}>
              Add this secret to any authenticator app (Google Authenticator, Authy, etc.): <b>{setup.secret}</b>
            </p>
            <div className="field">
              <label>Enter the 6-digit code it shows</label>
              <input value={totpCode} onChange={e => setTotpCode(e.target.value)} maxLength={6} inputMode="numeric" required />
            </div>
            <button className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} type="submit">Confirm & enable</button>
          </form>
        )}
        {!setup && (
          <div className="field" style={{ marginTop: 14 }}>
            <label>Password (to disable 2FA)</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Only needed to disable" />
          </div>
        )}
      </div>

      <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Deactivate account</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>
          Hides your profile and content. Log back in any time to reactivate.
        </p>
        <button className="btn-ghost" onClick={deactivate}>Deactivate my account</button>
      </div>

      <div className="glass-card" style={{ padding: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4, color: 'var(--pink)' }}>Delete account</div>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>
          Your account is deactivated immediately and permanently deleted after a 14-day grace period,
          unless you log back in to cancel.
        </p>
        <form onSubmit={requestDelete}>
          <div className="field">
            <label>Confirm your password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <div className="field">
            <label>Reason (optional)</label>
            <input value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <button className="btn-ghost" style={{ color: 'var(--pink)', borderColor: 'rgba(255,92,147,0.35)' }} type="submit">Request account deletion</button>
        </form>
      </div>
    </div>
  );
}
