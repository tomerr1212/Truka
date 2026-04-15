// ─── Troca color palette ──────────────────────────────────────────────────────
// Warm capoeira arena: clay, parchment, leather, turquoise, ember, gold

export const COLORS = {
  // Role / action colors
  primary:      '#E8732A',  // clay orange — attacker, primary CTA
  primaryLight: '#FDE8D8',
  accent:       '#3ABFBF',  // turquoise — defender, evasion
  danger:       '#C0392B',  // maculelê red — penalty, elimination
  ember:        '#8B2F0E',  // deep ember — REVEAL banner, high-contrast
  gold:         '#C9983A',  // Floreo, magic activation, premium highlight
  coral:        '#E85F40',  // near-elimination warning (4 maculelê)

  // Surfaces (parchment + arena)
  bg:           '#F0E6CC',  // arena floor — warm sand
  surface:      '#FAF5EC',  // parchment — cards, elevated panels
  card:         '#FAF5EC',  // card surface (parchment, not white)

  // Text + borders
  text:         '#2C1A0E',  // deep brown
  leather:      '#3D2210',  // dark leather — stamps, token outlines
  muted:        '#9E8A74',  // secondary text
  border:       '#C4A97D',  // engraved parchment border
  sand:         '#DDD0BC',  // inactive dividers, empty slots
};

export const FONT = {
  heading: { fontWeight: '800' as const, letterSpacing: -0.5 },
  body:    { fontWeight: '400' as const },
  label:   { fontWeight: '600' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },
};
