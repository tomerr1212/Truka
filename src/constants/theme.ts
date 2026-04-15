// ─── Troca color palette ──────────────────────────────────────────────────────
// Warm orange primary, deep brown, cream, turquoise accent — matching PDF identity

export const COLORS = {
  primary:      '#E8732A',  // warm orange
  primaryLight: '#FDE8D8',
  accent:       '#3ABFBF',  // turquoise
  danger:       '#C0392B',  // maculelê red
  bg:           '#F5ECD7',  // warm cream
  surface:      '#FDFAF3',
  card:         '#FFFFFF',
  text:         '#2C1A0E',  // deep brown
  muted:        '#9E8A74',
  border:       '#DDD0BC',
};

export const FONT = {
  heading: { fontWeight: '800' as const, letterSpacing: -0.5 },
  body:    { fontWeight: '400' as const },
  label:   { fontWeight: '600' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },
};
