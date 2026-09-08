export default function Avatar({ name, color = '#7C5CFF', size = 40 }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
    >
      {initial}
    </div>
  );
}
