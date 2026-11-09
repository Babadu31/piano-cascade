import { parseKey, parseNote } from './theory.js';

/* ================= Morceaux intégrés (domaine public) =================
   Format : NOTE:durée (en temps). Durée omise = durée précédente. R = silence. Accord : C4+E4+G4:2
   Les notes gardent leur orthographe (D#5 ≠ Eb5). ts = chiffrage, key = tonalité (« Am » = la mineur).
   unit = valeur d'un temps du texte en noires (0.5 : le texte est écrit en croches). pickup = durée de la levée. */
export const BUILTIN = [
  { id:'gamme', cat:'Exercices', title:'Exercice – Gamme de Do (main droite)', bpm:70, ts:'4/4', key:'C',
    rh:'C4:1 D4 E4 F4 G4 A4 B4 C5 B4 A4 G4 F4 E4 D4 C4:2' },
  { id:'gamme-mg', cat:'Exercices', title:'Exercice – Gamme de Do (main gauche)', bpm:70, ts:'4/4', key:'C',
    lh:'C3:1 D3 E3 F3 G3 A3 B3 C4 B3 A3 G3 F3 E3 D3 C3:2' },
  { id:'clair', cat:'Débutant', title:'Au clair de la lune', bpm:90, ts:'4/4', key:'C',
    rh:'C4:1 C4 C4 D4 E4:2 D4:2 C4:1 E4 D4 D4 C4:4 C4:1 C4 C4 D4 E4:2 D4:2 C4:1 E4 D4 D4 C4:4 ' +
       'D4:1 D4 D4 D4 A3:2 A3:2 D4:1 C4 B3 A3 G3:4 C4:1 C4 C4 D4 E4:2 D4:2 C4:1 E4 D4 D4 C4:4' },
  { id:'jacques', cat:'Débutant', title:'Frère Jacques', bpm:100, ts:'4/4', key:'C',
    rh:'C4:1 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:2 E4:1 F4 G4:2 G4:0.5 A4 G4 F4 E4:1 C4 ' +
       'G4:0.5 A4 G4 F4 E4:1 C4 C4:1 G3 C4:2 C4:1 G3 C4:2' },
  { id:'maman', cat:'Débutant', title:'Ah ! vous dirai-je, maman', bpm:90, ts:'4/4', key:'C',
    rh:'C4:1 C4 G4 G4 A4 A4 G4:2 F4:1 F4 E4 E4 D4 D4 C4:2 G4:1 G4 F4 F4 E4 E4 D4:2 ' +
       'G4:1 G4 F4 F4 E4 E4 D4:2 C4:1 C4 G4 G4 A4 A4 G4:2 F4:1 F4 E4 E4 D4 D4 C4:2' },
  { id:'joie', cat:'Classique', title:'Ode à la joie – Beethoven (2 mains)', bpm:80, ts:'4/4', key:'C',
    rh:'E4:1 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2 ' +
       'E4:1 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:0.5 C4:2 ' +
       'D4:1 D4 E4 C4 D4 E4:0.5 F4 E4:1 C4 D4 E4:0.5 F4 E4:1 D4 C4 D4 G3:2 ' +
       'E4:1 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:0.5 C4:2',
    lh:'C3:4 G2 C3 G2 C3 G2 C3 G2:2 C3 G2:4 G2:2 C3 G2:4 C3:2 G2 C3:4 G2 C3 G2:2 C3' },
  { id:'elise', cat:'Classique', title:'Lettre à Élise – Beethoven (début, 2 mains)', bpm:66, ts:'3/8', key:'Am', unit:0.5,
    pickup:1,
    rh:'E5:0.5 D#5 E5 D#5 E5 B4 D5 C5 A4:1 R:0.5 C4 E4 A4 B4:1 R:0.5 E4 G#4 B4 C5:1 R:0.5 E4 E5 D#5 ' +
       'E5 D#5 E5 B4 D5 C5 A4:1 R:0.5 C4 E4 A4 B4:1 R:0.5 E4 C5 B4 A4:3',
    lh:'R:4 A2:0.5 E3 A3 R:1.5 E2:0.5 E3 G#3 R:1.5 A2:0.5 E3 A3 R:1.5 R:3 A2:0.5 E3 A3 R:1.5 E2:0.5 E3 G#3 R:1.5 A2:0.5 E3 A3:2' },
  { id:'accords', cat:'Exercices', title:'Exercice – Accords Do, Fa, Sol (main gauche)', bpm:60, ts:'4/4', key:'C',
    lh:'C3+E3+G3:4 F2+A2+C3 G2+B2+D3 C3+E3+G3 C3+E3+G3:2 F2+A2+C3 G2+B2+D3 C3+E3+G3' },
  { id:'cinq', cat:'Exercices', title:'Exercice – Cinq doigts (2 mains)', bpm:80, ts:'4/4', key:'C',
    rh:'C4:1 D4 E4 F4 G4 F4 E4 D4 C4 E4 G4 E4 C4:4',
    lh:'C3:1 D3 E3 F3 G3 F3 E3 D3 C3 E3 G3 E3 C3:4' },
  { id:'anniv', cat:'Fêtes', title:'Joyeux anniversaire', bpm:100, ts:'3/4', key:'C',
    pickup:1,
    rh:'G4:0.75 G4:0.25 A4:1 G4 C5 B4:2 G4:0.75 G4:0.25 A4:1 G4 D5 C5:2 G4:0.75 G4:0.25 G5:1 E5 C5 B4 A4 F5:0.75 F5:0.25 E5:1 C5 D5 C5:3',
    lh:'R:1 C3:3 G2 G2 C3 C3 F2 G2 C3' },
  { id:'jingle', cat:'Fêtes', title:'Vive le vent (Jingle Bells)', bpm:110, ts:'4/4', key:'C',
    rh:'E4:1 E4 E4:2 E4:1 E4 E4:2 E4:1 G4 C4:1.5 D4:0.5 E4:4 F4:1 F4 F4:1.5 F4:0.5 F4:1 E4 E4 E4:0.5 E4 E4:1 D4 D4 E4 D4:2 G4:2 ' +
       'E4:1 E4 E4:2 E4:1 E4 E4:2 E4:1 G4 C4:1.5 D4:0.5 E4:4 F4:1 F4 F4:1.5 F4:0.5 F4:1 E4 E4 E4:0.5 E4 G4:1 G4 F4 D4 C4:4',
    lh:'C3:4 C3 C3 C3 F2 C3 G2 G2 C3 C3 C3 C3 F2 C3 G2 C3' },
  { id:'greensleeves', cat:'Débutant', title:'Greensleeves (traditionnel)', bpm:100, ts:'3/4', key:'Am',
    pickup:1,
    rh:'A4:1 C5:2 D5:1 E5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:2 A4:1 A4:1.5 G#4:0.5 A4:1 B4:2 G#4:1 E4:2 A4:1 ' +
       'C5:2 D5:1 E5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:1.5 B4:0.5 A4:1 G#4:1.5 F#4:0.5 G#4:1 A4:3',
    lh:'R:1 A2:3 C3 G2 E2 A2 E2 E2 A2 A2 C3 G2 E2 A2 E2 A2' },
  { id:'brahms', cat:'Débutant', title:'Berceuse – Brahms', bpm:84, ts:'3/4', key:'C',
    pickup:1,
    rh:'E4:0.5 E4 G4:2 E4:0.5 E4 G4:2 E4:0.5 G4 C5:1 B4 A4 A4 G4 D4:0.5 E4 F4:1 D4 D4:0.5 E4 F4:2 D4:0.5 F4 B4 A4 G4:1 B4 C5:3',
    lh:'R:1 C3:3 C3 F2 C3 G2 G2 G2 C3' },
  { id:'nouveaumonde', cat:'Classique', title:'Symphonie du Nouveau Monde (Largo) – Dvořák', bpm:60, ts:'4/4', key:'C',
    rh:'E4:1.5 G4:0.5 G4:2 E4:1.5 D4:0.5 C4:2 D4:1 E4 G4 E4 D4:4 E4:1.5 G4:0.5 G4:2 E4:1.5 D4:0.5 C4:2 D4:1 E4 D4 C4 C4:4',
    lh:'C3+G3:4 C3+G3 G2+D3 G2+D3 C3+G3 C3+G3 G2+D3 C3+G3' },
  { id:'menuet', cat:'Classique', title:'Menuet en Sol – Bach / Petzold (simplifié)', bpm:100, ts:'3/4', key:'G',
    rh:'D5:1 G4:0.5 A4 B4 C5 D5:1 G4 G4 E5:1 C5:0.5 D5 E5 F#5 G5:1 G4 G4 C5:1 D5:0.5 C5 B4 A4 B4:1 C5:0.5 B4 A4 G4 F#4:1 G4:0.5 A4 B4 G4 A4:3 ' +
       'D5:1 G4:0.5 A4 B4 C5 D5:1 G4 G4 E5:1 C5:0.5 D5 E5 F#5 G5:1 G4 G4 C5:1 D5:0.5 C5 B4 A4 B4:1 C5:0.5 B4 A4 G4 A4:1 B4:0.5 A4 G4 F#4 G4:3',
    lh:'G3:3 B3 C4 B3 A3 G3 D3 D3 G3 B3 C4 B3 A3 G3 D3 G3' },
  { id:'canon', cat:'Classique', title:'Canon en Ré – Pachelbel (simplifié)', bpm:60, ts:'4/4', key:'D',
    rh:'F#5:2 E5 D5 C#5 B4 A4 B4 C#5 D5:2 C#5 B4 A4 G4 F#4 G4 E4 D4:1 F#4 A4 G4 F#4 D4 F#4 E4 D4 B3 D4 A4 G4 B4 A4 G4',
    lh:'D3:2 A2 B2 F#2 G2 D2 G2 A2 D3 A2 B2 F#2 G2 D2 G2 A2 D3 A2 B2 F#2 G2 D2 G2 A2' },
  { id:'gymnopedie', cat:'Classique', title:'Gymnopédie n°1 – Satie (début)', bpm:72, ts:'3/4', key:'D',
    rh:'R:12 R:1 F#5:1 A5 G5 F#5 C#5 B4 C#5 D5 A4:3 F#4:12',
    lh:'G2:1 B3+D4+F#4:2 D2:1 A3+C#4+F#4:2 G2:1 B3+D4+F#4:2 D2:1 A3+C#4+F#4:2 G2:1 B3+D4+F#4:2 D2:1 A3+C#4+F#4:2 ' +
       'G2:1 B3+D4+F#4:2 D2:1 A3+C#4+F#4:2 G2:1 B3+D4+F#4:2 D2:1 A3+C#4+F#4:2 G2:1 B3+D4+F#4:2 D2:1 A3+C#4+F#4:2' },
  { id:'roimontagne', cat:'Classique', title:'Dans l\'antre du roi de la montagne – Grieg', bpm:120, ts:'4/4', key:'Bm',
    rh:'B3:0.5 C#4 D4 E4 F#4 D4 F#4:1 F4:0.5 C#4 F4:1 E4:0.5 C4 E4:1 B3:0.5 C#4 D4 E4 F#4 D4 F#4 B4 A4 F#4 D4 F#4 A4:2 ' +
       'B3:0.5 C#4 D4 E4 F#4 D4 F#4:1 F4:0.5 C#4 F4:1 E4:0.5 C4 E4:1 B3:0.5 C#4 D4 E4 F#4 D4 F#4 B4 A4 F#4 D4 F#4 A4:2',
    lh:'B2:4 F#2 B2 F#2 B2:4 F#2 B2 F#2' },
];

export function parseSeq(str, hand, unit = 1) {
  const notes = [];
  if (!str) return notes;
  let t = 0, dur = 1;
  for (const tok of str.trim().split(/\s+/)) {
    const [p, d] = tok.split(':');
    if (d !== undefined) { dur = parseFloat(d); if (!(dur > 0)) throw new Error('Durée invalide : ' + tok); }
    if (p !== 'R') {
      for (const part of p.split('+')) {
        const nt = parseNote(part);
        if (!nt) throw new Error('Note invalide : ' + tok);
        notes.push({ midi:nt.midi, sp:nt.sp, start:t * unit, dur:dur * unit, hand });
      }
    }
    t += dur;
  }
  return notes;
}
export function buildBuiltin(def) {
  const [num, den] = def.ts.split('/').map(Number), u = def.unit || 1;
  return { id:def.id, cat:def.cat, title:def.title, bpm:def.bpm, ts:{ num, den }, key:parseKey(def.key), pickup:(def.pickup || 0) * u,
           notes:[...parseSeq(def.rh, 'R', u), ...parseSeq(def.lh, 'L', u)] };
}

/** Morceaux disponibles (intégrés + importés). Rempli au démarrage. */
export const songs = [];
