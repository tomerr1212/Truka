import { Card, CardSubtype } from '../types';

// ─── Deck composition (confirmed by game designer) ───────────────────────────
// Kick: 12 | Evasion: 12 | Knockdown: 12 | Floreo: 4 | Troca: 4
// Chamada: 2 | Compra: 2 | Agogô: 2 | Malandragem: 2 | Jurema: 2
// Total main deck: 54 cards
// Maculelê supply (separate): 20

export const DECK_COMPOSITION: Record<CardSubtype, number> = {
  kick: 12,
  evasion: 12,
  knockdown: 12,
  floreo: 4,
  troca: 4,
  chamada: 2,
  compra: 2,
  agogo: 2,
  malandragem: 2,
  jurema: 2,
};

export const MACULELE_SUPPLY = 20;
export const STARTING_HAND_SIZE = 4;
export const ELIMINATION_THRESHOLD = 5;

// ─── Card definitions ────────────────────────────────────────────────────────

const CARD_DEFS: Omit<Card, 'id'>[] = [
  // Action cards
  {
    type: 'action',
    subtype: 'kick',
    nameHe: 'בעיטה',
    namePt: 'Bênção',
    descriptionHe: 'קלף תקיפה. מול הפלה — מקוללה לבעיטה. מול עוד בעיטה — שניהם מקוללה.',
    imageAsset: 'cards/kick',
  },
  {
    type: 'action',
    subtype: 'evasion',
    nameHe: 'התחמקות',
    namePt: 'Esquiva',
    descriptionHe: 'קלף הגנה. מול הפלה — מקוללה להפלה. מול עוד התחמקות — שחקו שוב.',
    imageAsset: 'cards/evasion',
  },
  {
    type: 'action',
    subtype: 'knockdown',
    nameHe: 'הפלה',
    namePt: 'Rasteira',
    descriptionHe: 'קלף תקיפה. מול בעיטה — מקוללה לבעיטה. מול עוד הפלה — שניהם מקוללה.',
    imageAsset: 'cards/knockdown',
  },
  // Special cards
  {
    type: 'floreo',
    subtype: 'floreo',
    nameHe: 'פלוריאו',
    namePt: 'Floreo',
    descriptionHe: 'צרף לקלף פעולה. מכפיל מקוללה שמתקבל. בעיטה+התחמקות עם פלוריאו: שניהם מורידים מקוללה אחד.',
    imageAsset: 'cards/floreo',
  },
  {
    type: 'special',
    subtype: 'troca',
    nameHe: 'טרוקה',
    namePt: 'Troca',
    descriptionHe: 'לאחר גילוי: התוקף או המותקף יכולים להניח טרוקה עם קלף פעולה חדש. תוצאה מחושבת מחדש.',
    imageAsset: 'cards/troca',
  },
  {
    type: 'special',
    subtype: 'chamada',
    nameHe: 'שמאדה',
    namePt: 'Chamada',
    descriptionHe: 'בתחילת תורך: בחר שחקן שיתקוף אותך עם קלף פתוח. אתה גם מגיב בפתוח.',
    imageAsset: 'cards/chamada',
  },
  {
    type: 'special',
    subtype: 'compra',
    nameHe: 'קומפרה',
    namePt: 'Compra',
    descriptionHe: 'לאחר גילוי: שחקן שאינו תוקף/מותקף נכנס להתנגשות, מחליף שחקן אחד ומניח קלף חדש.',
    imageAsset: 'cards/compra',
  },
  {
    type: 'special',
    subtype: 'agogo',
    nameHe: 'אגוגו',
    namePt: 'Agogô',
    descriptionHe: 'בתחילת תורך: השלם ל-4 קלפים (אם יש פחות) ודלג על התור.',
    imageAsset: 'cards/agogo',
  },
  {
    type: 'special',
    subtype: 'malandragem',
    nameHe: 'מלנדראז׳',
    namePt: 'Malandragem',
    descriptionHe: 'בתחילת תורך: הצץ בכל הקלפים של שחקן לבחירתך.',
    imageAsset: 'cards/malandragem',
  },
  {
    type: 'special',
    subtype: 'jurema',
    nameHe: 'ז׳ורמה',
    namePt: 'Jurema',
    descriptionHe: 'כשמגיעים ל-5 מקוללה: חייב לשחק מיד. מאפס ל-4 מקוללה במקום להיפסל.',
    imageAsset: 'cards/jurema',
  },
];

// ─── Build full deck with unique IDs ─────────────────────────────────────────

export function buildCardDefinitions(): Map<string, Card> {
  const map = new Map<string, Card>();
  let counter = 0;

  for (const def of CARD_DEFS) {
    const count = DECK_COMPOSITION[def.subtype];
    for (let i = 0; i < count; i++) {
      const id = `${def.subtype}_${String(counter).padStart(3, '0')}`;
      map.set(id, { ...def, id });
      counter++;
    }
  }

  return map;
}

export function buildDeckIds(): string[] {
  const ids: string[] = [];
  let counter = 0;

  for (const def of CARD_DEFS) {
    const count = DECK_COMPOSITION[def.subtype];
    for (let i = 0; i < count; i++) {
      ids.push(`${def.subtype}_${String(counter).padStart(3, '0')}`);
      counter++;
    }
  }

  return ids;
}
