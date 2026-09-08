import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import { useAuth } from '../AuthContext.jsx';
import { connectSocket } from '../socket.js';

function Board({ room, myId, onMove }) {
  const { board, turn, winner, marks } = room.state;
  const myTurn = turn === myId && !winner;
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 14, fontSize: 14, color: 'var(--text-mid)' }}>
        {winner === 'draw' && "It's a draw!"}
        {winner && winner !== 'draw' && (winner === myId ? 'You won! 🎉' : 'You lost this round.')}
        {!winner && (myTurn ? "Your turn" : 'Waiting for opponent…')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 84px)', gap: 8, justifyContent: 'center' }}>
        {board.map((cell, i) => (
          <button key={i} onClick={() => !cell && myTurn && onMove(i)}
            style={{
              width: 84, height: 84, borderRadius: 14, fontSize: 32, fontWeight: 700,
              background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-soft)',
              color: cell === marks[myId] ? 'var(--violet-bright)' : 'var(--pink)',
              cursor: !cell && myTurn ? 'pointer' : 'default',
            }}>
            {cell}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Games() {
  const { user } = useAuth();
  const [games, setGames] = useState(null);
  const [myRooms, setMyRooms] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [room, setRoom] = useState(null);

  const loadStore = async () => {
    const [g, r] = await Promise.all([api.games(), api.myGameRooms()]);
    setGames(g.games);
    setMyRooms(r.rooms);
  };
  useEffect(() => { loadStore(); }, []);

  useEffect(() => {
    if (!room) return;
    const socket = connectSocket();
    const onState = (r) => { if (r.id === room.id) setRoom(r); };
    const onError = (e) => setError(e.message);
    socket.on('game:state', onState);
    socket.on('game:error', onError);
    socket.emit('game:join', { roomId: room.id });
    return () => {
      socket.off('game:state', onState);
      socket.off('game:error', onError);
    };
    // eslint-disable-next-line
  }, [room?.id]);

  const create = async (gameId) => {
    setError('');
    const res = await api.createGameRoom(gameId);
    setRoom(res.room);
  };

  const join = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.joinGameRoom(joinCode.trim());
      setRoom(res.room);
    } catch (err) { setError(err.message); }
  };

  const ready = () => connectSocket().emit('game:ready', { roomId: room.id });
  const move = (cell) => connectSocket().emit('game:move', { roomId: room.id, cell });
  const leave = () => {
    connectSocket().emit('game:leave', { roomId: room.id });
    setRoom(null);
    loadStore();
  };

  if (room) {
    const me = room.players.find(p => p.user.id === user.id);
    const isFull = room.players.length === room.capacity;
    return (
      <div>
        <button className="btn-ghost" style={{ marginBottom: 16 }} onClick={leave}>← Leave game</button>
        <div className="glass-card" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 4 }}>Tic-Tac-Toe</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-low)', marginBottom: 18 }}>Room code: <b>{room.inviteCode}</b></div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 20 }}>
            {room.players.map(p => (
              <div key={p.user.id} style={{ textAlign: 'center' }}>
                <Avatar name={p.user.displayName} color={p.user.avatarColor} size={44} />
                <div style={{ fontSize: 12.5, marginTop: 6 }}>{p.user.displayName}</div>
                {room.status === 'waiting' && <div style={{ fontSize: 11, color: p.ready ? 'var(--teal)' : 'var(--text-low)' }}>{p.ready ? 'Ready' : 'Not ready'}</div>}
              </div>
            ))}
            {!isFull && <div style={{ textAlign: 'center', color: 'var(--text-low)', fontSize: 12.5 }}>Waiting for a<br />second player…</div>}
          </div>

          {error && <div className="error-banner">{error}</div>}

          {room.status === 'waiting' && isFull && (
            <button className="btn-primary" style={{ width: 'auto', padding: '10px 24px' }} disabled={me?.ready} onClick={ready}>
              {me?.ready ? 'Waiting for opponent…' : "I'm ready"}
            </button>
          )}
          {room.status === 'waiting' && !isFull && (
            <div style={{ fontSize: 13, color: 'var(--text-mid)' }}>Share code <b>{room.inviteCode}</b> with a friend to start.</div>
          )}
          {(room.status === 'active' || room.status === 'finished') && (
            <Board room={room} myId={user.id} onMove={move} />
          )}
          {room.status === 'finished' && (
            <button className="btn-ghost" style={{ marginTop: 16 }} onClick={leave}>Back to Game Store</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Game Store</h2>

      {myRooms?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: 'var(--text-low)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>My Games</div>
          {myRooms.map(r => (
            <div key={r.id} className="glass-card convo-item" style={{ padding: 12, marginBottom: 8 }} onClick={() => setRoom(r)}>
              <div className="last">Tic-Tac-Toe · room {r.inviteCode} · {r.status}</div>
            </div>
          ))}
        </div>
      )}

      <div className="glass-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 4 }}>Tic-Tac-Toe</div>
        <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>Board · 2 players · realtime</div>
        <button className="btn-primary" style={{ width: 'auto', padding: '9px 20px' }} onClick={() => create('tic-tac-toe')} disabled={games === null}>
          Create room
        </button>
      </div>

      <form className="glass-card" style={{ padding: 20 }} onSubmit={join}>
        <div style={{ fontSize: 13.5, marginBottom: 10, color: 'var(--text-mid)' }}>Have a room code?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="e.g. XYZ123"
            style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '9px 12px', color: 'var(--text-hi)', outline: 'none', fontSize: 14, textTransform: 'uppercase' }} />
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 18px' }} type="submit">Join</button>
        </div>
        {error && <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}
      </form>
    </div>
  );
}
