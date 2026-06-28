// Deterministic avatar: initials + hashed background from palette.

const PALETTE = [
  { bg: '#A7F3D0', fg: '#064E3B' }, // emerald
  { bg: '#C4B5FD', fg: '#3B0764' }, // violet
  { bg: '#FCD34D', fg: '#451A03' }, // amber
  { bg: '#FECDD3', fg: '#881337' }, // rose
  { bg: '#BAE6FD', fg: '#0C4A6E' }, // sky
  { bg: '#FED7AA', fg: '#7C2D12' }, // peach
  { bg: '#BBF7D0', fg: '#064E3B' }, // mint
  { bg: '#CBD5E1', fg: '#0F172A' }, // slate
];

function hash(s = '') {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarTheme(seed) {
  return PALETTE[hash(seed) % PALETTE.length];
}

export function avatarInitials(nameOrEmail = '?') {
  const src = nameOrEmail.split('@')[0];
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}

const SIZE_PX = { xs: 18, sm: 22, md: 28, lg: 36, xl: 48 };
const SIZE_FONT = { xs: 9, sm: 10, md: 11, lg: 13, xl: 17 };

export default function Avatar({ seed, name, size = 'md', ring = false, title }) {
  const id = seed || name || '?';
  const theme = avatarTheme(id);
  const px = SIZE_PX[size];
  const fs = SIZE_FONT[size];
  return (
    <div
      className="rounded-full inline-flex items-center justify-center select-none shrink-0"
      style={{
        width:  px,
        height: px,
        background: theme.bg,
        color:      theme.fg,
        fontSize:   fs,
        fontWeight: 600,
        boxShadow:  ring ? '0 0 0 2px var(--bg-elevated)' : undefined,
        letterSpacing: '0.02em',
      }}
      title={title || name}
      aria-label={name || id}
    >
      {avatarInitials(name || id)}
    </div>
  );
}

export function AvatarStack({ members, max = 5, size = 'sm' }) {
  const visible  = members.slice(0, max);
  const overflow = members.length - visible.length;
  const offset = SIZE_PX[size] * 0.45;
  return (
    <div className="flex items-center" role="group" aria-label="Team avatars">
      {visible.map((m, i) => (
        <div
          key={m.email || m.name || i}
          style={{ marginLeft: i === 0 ? 0 : -offset, zIndex: visible.length - i }}
        >
          <Avatar seed={m.email} name={m.name} size={size} ring />
        </div>
      ))}
      {overflow > 0 && (
        <div
          className="rounded-full inline-flex items-center justify-center bg-s2 text-ink-dim text-[10px] font-semibold"
          style={{ width: SIZE_PX[size], height: SIZE_PX[size], marginLeft: -offset, boxShadow: '0 0 0 2px var(--bg-elevated)' }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
