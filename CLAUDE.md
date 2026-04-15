# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start        # Start Expo dev server
npm run android      # Run on Android
npm run ios          # Run on iOS (macOS only)
npm run web          # Run in browser
npx tsc --noEmit     # Type check (zero errors = passing)
```

No test runner configured yet. Add Jest + jest-expo for unit tests when needed.

## Architecture

**Stack:** React Native (Expo) + TypeScript + Firebase Realtime Database + Zustand

```
src/
  types/        — shared TypeScript interfaces (Match, Player, Card, TurnPhase, etc.)
  constants/    — deck composition (54 cards, confirmed counts), color theme
  engine/       — pure rule engine, no UI, no network
  services/     — Firebase wrappers (matchService, firebase init)
  store/        — Zustand game store (match state, hand, legal card set)
  screens/      — React Native screens
  navigation/   — Stack navigator + route param types
firebase/       — database.rules.json (security rules)
```

## Game: Troca

Capoeira card game, 3–6 players. Goal: last player standing at 5 maculelê = eliminated.

**Deck (54 cards):** Kick×12, Evasion×12, Knockdown×12, Floreo×4, Troca×4, Chamada×2, Compra×2, Agogô×2, Malandragem×2, Jurema×2. Plus 20 maculelê tokens (separate supply).

**Turn phases:**
```
START_OF_TURN → ACTION_SELECTION → REVEAL → START_OF_TURN
                                          ↘ BURN_REVEAL → START_OF_TURN
                                          ↘ JUREMA_REVEAL → START_OF_TURN
```
- `BURN_REVEAL`: defender has no action cards — exposes hand to all players, takes +1 maculelê, draws 4
- `JUREMA_REVEAL`: a player just hit 5 maculelê and Jurema saved them — notification shown to all before advancing

### Collision table (engine/collision.ts)
- Kick vs Evasion → nothing
- Kick vs Knockdown → Kick gets maculelê
- Kick vs Kick → both get maculelê
- Evasion vs Knockdown → Knockdown gets maculelê
- Evasion vs Evasion → no maculelê, **both play follow-up** (chains until non-Evasion result)
- Knockdown vs Knockdown → both get maculelê

### Replenishment (engine/replenishment.ts)
Based on last card played (Troca/Compra replacement counts as last):
- Kick → draw to 5
- Knockdown → draw to 4
- Evasion → no draw

### Floreo rules
- Attached to action card at placement (not standalone; Floreo is never a legal standalone play)
- Both attacker and defender can attach Floreo — effect is the same (not doubled)
- Doubles maculelê received by whoever gets it
- Exception: Kick vs Evasion + any Floreo → both players **remove** 1 maculelê
- Canceled if Troca or Compra replaces the card it was attached to
- Does not stack; Evasion vs Evasion → Floreo burned, play again

### Special cards
- **Troca** (REVEAL phase): attacker or defender plays new action card, recalculate
- **Compra** (REVEAL phase): third-party only; replaces one participant; sequential if multiple
- **Chamada** (START_OF_TURN): target must attack with face-up card; Chamada player also responds face-up
- **Malandragem** (START_OF_TURN): peek at any player's full hand (view only)
- **Agogô** (START_OF_TURN): draw to 4 (0 if already ≥4), skip turn
- **Jurema**: triggered automatically at 5 maculelê, resets count to 4; triggers `JUREMA_REVEAL` phase
- **Sequência**: REMOVED from game — do not implement

## Rule engine design

`src/engine/` is intentionally pure functions — no React, no Firebase. This makes rules unit-testable in isolation.

**Legality:** `getLegalCardIds(ctx)` returns the set of playable card IDs for a player in a given phase. The UI greys out anything outside this set.

**Client-side turn driver (current):** Cloud Functions are not deployed yet. The attacker's client drives all state transitions and writes to `/matches/{matchId}` directly via `writeMatchUpdate` / `writeFullMatch`. Clients still write action intents to `/staging/{matchId}/{playerId}` first; the attacker's staging watcher detects both staged → advances to REVEAL.

**Attacker-first rule:** Defender cannot act until the attacker has staged their card (`canDefenderAct = isDefender && attackerHasStaged`). This gate applies to action card selection, Floreo attachment, and the PLAY CARD button.

## Firebase setup

Copy `.env.example` to `.env.local` and fill in your Firebase project values. Security rules are in `firebase/database.rules.json` — player hands are readable only by their owner.

**Firebase array normalization:** Firebase Realtime DB stores JS arrays as `{0: ..., 1: ...}` objects. `normalizeMatch()` in `matchService.ts` converts them back via `toArray()`. It also filters out partial entries created by `startMatch`'s per-player hand writes (those use player UIDs as keys, which collide with numeric array keys).

## What's not built yet

- Cloud Functions (authoritative server-side resolver) — engine code in `src/engine/` is ready to copy into `functions/`
- Turn timer / auto-skip
- Tutorial screen (placeholder routes to CardGallery)
- Push notifications
- Card artwork assets (placeholders in place)
