import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

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
