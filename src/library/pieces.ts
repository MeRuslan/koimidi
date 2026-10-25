/**
 * Built-in library. Every piece is in the public domain and typeset here from
 * scratch in koimidi's compact notation (see src/score/notation.ts).
 * Fingering marked with ":n" is editorial; the rest is computed automatically.
 */
export interface LibraryEntry {
  id: string;
  text: string;
}

export const PIECES: LibraryEntry[] = [
  {
    id: 'twinkle',
    text: `
title: Twinkle, Twinkle, Little Star
title_ru: Twinkle, Twinkle, Little Star
composer: Traditional (France, 18th century)
composer_ru: Французская народная, XVIII век
time: 4/4
tempo: 100
difficulty: 1
R: @A C4:1 C4 G4:5 G4 | A4:5 A4 G4/2:4 | F4/4:3 F4 E4:2 E4 | D4:2 D4 C4/2:1 |
R: @B G4/4:5 G4 F4:4 F4 | E4:3 E4 D4/2:2 | G4/4:5 G4 F4:4 F4 | E4:3 E4 D4/2:2 |
R: @A2 C4/4:1 C4 G4:5 G4 | A4:5 A4 G4/2:4 | F4/4:3 F4 E4:2 E4 | D4:2 D4 C4/2:1 |
`,
  },
  {
    id: 'mary-lamb',
    text: `
title: Mary Had a Little Lamb
title_ru: Mary Had a Little Lamb
composer: Traditional (USA, 1830s)
composer_ru: Американская народная, 1830‑е
time: 4/4
tempo: 108
difficulty: 1
R: E4:3 D4:2 C4:1 D4:2 | E4:3 E4 E4/2 | D4/4:2 D4 D4/2 | E4/4:3 G4:5 G4/2 |
R: E4/4:3 D4:2 C4:1 D4:2 | E4:3 E4 E4 E4 | D4:2 D4 E4:3 D4:2 | C4/1:1 |
`,
  },
  {
    id: 'frere-jacques',
    text: `
title: Frère Jacques
title_ru: Frère Jacques (Братец Яков)
composer: Traditional (France)
composer_ru: Французская народная
time: 4/4
tempo: 112
difficulty: 1
R: @A C4:1 D4:2 E4:3 C4:1 | C4 D4 E4 C4 | @B E4:3 F4:4 G4/2:5 | E4/4 F4 G4/2 |
R: @C G4/8:5 A4 G4 F4 E4/4:3 C4:1 | G4/8:5 A4 G4 F4 E4/4:3 C4:1 | @D C4/4:2 G3:1 C4/2:2 | C4/4:2 G3:1 C4/2:2 |
`,
  },
  {
    id: 'london-bridge',
    text: `
title: London Bridge Is Falling Down
title_ru: London Bridge Is Falling Down
composer: Traditional (England)
composer_ru: Английская народная
time: 4/4
tempo: 104
difficulty: 1
R: @A G4/4.:5 A4/8 G4/4:5 F4:4 | E4:3 F4:4 G4/2:5 | D4/4:2 E4:3 F4/2:4 | E4/4:3 F4:4 G4/2:5 |
R: @B G4/4.:5 A4/8 G4/4:5 F4:4 | E4:3 F4:4 G4/2:5 | D4/2:2 G4/2:5 | E4/4:3 C4/2.:1 |
`,
  },
  {
    id: 'au-clair',
    text: `
title: Au clair de la lune
title_ru: Au clair de la lune (При свете луны)
composer: Traditional (France, 18th century)
composer_ru: Французская народная, XVIII век
time: 4/4
tempo: 100
difficulty: 1
R: @A C4:1 C4 C4 D4:2 | E4/2:3 D4/2:2 | C4/4:1 E4:3 D4:2 D4 | C4/1:1 |
R: C4/4 C4 C4 D4 | E4/2 D4/2 | C4/4 E4 D4 D4 | C4/1 |
R: @B D4/4:2 D4 D4 D4 | A3/2:1 A3/2 | D4/4:2 C4:2 B3:1 A3:1 | G3/1:1 |
R: @A2 C4/4:1 C4 C4 D4:2 | E4/2:3 D4/2:2 | C4/4:1 E4:3 D4:2 D4 | C4/1:1 |
`,
  },
  {
    id: 'ode-to-joy',
    text: `
title: Ode to Joy
title_ru: Ода к радости
composer: Ludwig van Beethoven (1824)
composer_ru: Людвиг ван Бетховен, 1824
time: 4/4
tempo: 112
difficulty: 2
R: @A E4:3 E4 F4:4 G4:5 | G4 F4:4 E4:3 D4:2 | C4:1 C4 D4:2 E4:3 | E4.:3 D4/8:2 D4/2:2 |
R: E4/4:3 E4 F4:4 G4:5 | G4 F4:4 E4:3 D4:2 | C4:1 C4 D4:2 E4:3 | D4.:2 C4/8:1 C4/2:1 |
R: @B D4/4:2 D4 E4:3 C4:1 | D4:2 E4/8:3 F4:4 E4/4:3 C4:1 | D4:2 E4/8:3 F4:4 E4/4:3 D4:2 | C4:1 D4:2 G3/2:1 |
R: @A2 E4/4:3 E4 F4:4 G4:5 | G4 F4:4 E4:3 D4:2 | C4:1 C4 D4:2 E4:3 | D4.:2 C4/8:1 C4/2:1 |
L: C3/1:1 | G2/1:5 | C3/1:1 | G2/2:5 C3/2:1 |
L: C3/1:1 | G2/1:5 | C3/1:1 | G2/2:5 C3/2:1 |
L: G2/1:5 | C3/2:1 G2/2:5 | C3/2:1 G2/2:5 | C3/2:1 G2/2:5 |
L: C3/1:1 | G2/1:5 | C3/1:1 | G2/2:5 C3/2:1 |
`,
  },
  {
    id: 'happy-birthday',
    text: `
title: Happy Birthday to You
title_ru: Happy Birthday to You
composer: Mildred J. Hill & Patty S. Hill (1893)
composer_ru: Милдред и Патти Хилл, 1893
time: 3/4
tempo: 108
pickup: 1
difficulty: 1
R: G4/8.:1 G4/16 | A4/4:2 G4:1 C5:4 | B4/2:3 G4/8.:1 G4/16 | A4/4:2 G4:1 D5:5 | C5/2:4 G4/8.:1 G4/16 |
R: G5/4:5 E5:3 C5:1 | B4:3 A4:2 F5/8.:5 F5/16 | E5/4:4 C5:2 D5:3 | C5/2.:2 |
`,
  },
  {
    id: 'jingle-bells',
    text: `
title: Jingle Bells (chorus)
title_ru: Jingle Bells (припев)
composer: James Lord Pierpont (1857)
composer_ru: Джеймс Пьерпонт, 1857
time: 4/4
tempo: 120
difficulty: 2
R: @A E4:3 E4 E4/2 | E4/4 E4 E4/2 | E4/4:3 G4:5 C4.:1 D4/8:2 | E4/1:3 |
R: F4/4:4 F4 F4. F4/8 | F4/4 E4:3 E4 E4/8 E4 | E4/4 D4:2 D4 E4:3 | D4/2:2 G4/2:5 |
R: @B E4/4:3 E4 E4/2 | E4/4 E4 E4/2 | E4/4:3 G4:5 C4.:1 D4/8:2 | E4/1:3 |
R: F4/4:4 F4 F4. F4/8 | F4/4 E4:3 E4 E4/8 E4 | G4/4:5 G4 F4:4 D4:2 | C4/1:1 |
`,
  },
  {
    id: 'silent-night',
    text: `
title: Silent Night
title_ru: Тихая ночь
composer: Franz Xaver Gruber (1818)
composer_ru: Франц Грубер, 1818
time: 6/8
tempo: 66
difficulty: 2
R: @A G4/4.:1 A4/8:2 G4/4:1 | E4/2.:1 | G4/4.:1 A4/8:2 G4/4:1 | E4/2.:1 |
R: @B D5/2:5 D5/4 | B4/2.:3 | C5/2:4 C5/4 | G4/2.:1 |
R: @C A4/2:2 A4/4 | C5/4.:4 B4/8:3 A4/4:2 | G4/4.:1 A4/8:2 G4/4:1 | E4/2.:1 |
R: A4/2:2 A4/4 | C5/4.:4 B4/8:3 A4/4:2 | G4/4.:1 A4/8:2 G4/4:1 | E4/2.:1 |
R: @D D5/2:4 D5/4 | F5/4.:5 D5/8:4 B4/4:2 | C5/2.:3 | E5/2.:5 |
R: C5/4:5 G4:3 E4:1 | G4/4.:3 F4/8:2 D4/4:1 | C4/2.:1~ | C4/2. |
`,
  },
  {
    id: 'we-wish',
    text: `
title: We Wish You a Merry Christmas
title_ru: We Wish You a Merry Christmas
composer: Traditional (England, 16th century)
composer_ru: Английская народная, XVI век
time: 3/4
tempo: 126
pickup: 1
difficulty: 2
R: G4/4:1 | C5:4 C5/8 D5:5 C5:4 B4:3 | A4/4:2 A4 A4 | D5:5 D5/8 E5 D5:4 C5:3 | B4/4:2 G4:1 G4 |
R: E5/4:5 E5/8 F5 E5:4 D5:3 | C5/4:2 A4:1 G4/8 G4 | A4/4:1 D5:4 B4:2 | C5/2:3 |
`,
  },
  {
    id: 'greensleeves',
    text: `
title: Greensleeves
title_ru: Greensleeves (Зелёные рукава)
composer: Traditional (England, 16th century)
composer_ru: Английская народная, XVI век
time: 6/8
tempo: 72
pickup: 0.5
difficulty: 2
R: E4/8:1 | @A G4/4:2 A4/8:3 B4/8.:4 C5/16:5 B4/8:4 | A4/4:3 F#4/8:2 D4/8.:1 E4/16 F#4/8:2 | G4/4:3 E4/8:1 E4/8.:1 D#4/16:1 E4/8:1 | F#4/4:2 D#4/8:1 B3/4:1 E4/8:1 |
R: G4/4:2 A4/8:3 B4/8.:4 C5/16:5 B4/8:4 | A4/4:3 F#4/8:2 D4/8.:1 E4/16 F#4/8:2 | G4/8.:4 F#4/16:3 E4/8:2 D#4/8.:1 C#4/16:1 D#4/8:1 | E4/4:2 E4/8 E4/4 D5/8:5 |
R: @B D5/4:5 D5/8 D5/8.:5 C5/16:4 B4/8:3 | A4/4:2 F#4/8:1 D4/8.:1 E4/16 F#4/8:2 | G4/4:3 E4/8:1 E4/8.:1 D#4/16:1 E4/8:1 | F#4/4:2 D#4/8:1 B3/4:1 D5/8:5 |
R: D5/4:5 D5/8 D5/8.:5 C5/16:4 B4/8:3 | A4/4:2 F#4/8:1 D4/8.:1 E4/16 F#4/8:2 | G4/8.:4 F#4/16:3 E4/8:2 D#4/8.:1 C#4/16:1 D#4/8:1 | E4/4:2 E4/8 E4/4. |
`,
  },
  {
    id: 'fur-elise-a',
    text: `
title: Für Elise (part A)
title_ru: К Элизе (часть A)
composer: Ludwig van Beethoven (1810)
composer_ru: Людвиг ван Бетховен, 1810
time: 3/8
tempo: 84
pickup: 0.5
difficulty: 3
R: E5/16:4 D#5:3 | @A E5:4 D#5:3 E5:4 B4:1 D5:3 C5:2 | A4/8:1 r/16 C4:1 E4:2 A4:3 | B4/8:1 r/16 E4:1 G#4:2 B4:3 | C5/8:1 r/16 E4:1 E5:4 D#5:3 |
R: E5/16:4 D#5:3 E5:4 B4:1 D5:3 C5:2 | A4/8:1 r/16 C4:1 E4:2 A4:3 | B4/8:1 r/16 E4:1 C5:3 B4:2 | A4/8:1 r/16 B4:2 C5:3 D5:4 |
R: @B E5/8.:5 G4/16:1 F5:4 E5:3 | D5/8.:4 F4/16:1 E5:3 D5:2 | C5/8.:3 E4/16:1 D5:2 C5:1 | B4/8:1 r/8 E4/16:1 E5:5 |
R: E5/16:4 D#5:3 E5:4 D#5:3 E5:4 D#5:3 | @A2 E5:4 D#5:3 E5:4 B4:1 D5:3 C5:2 | A4/8:1 r/16 C4:1 E4:2 A4:3 | B4/8:1 r/16 E4:1 G#4:2 B4:3 | C5/8:1 r/16 E4:1 E5:4 D#5:3 |
R: E5/16:4 D#5:3 E5:4 B4:1 D5:3 C5:2 | A4/8:1 r/16 C4:1 E4:2 A4:3 | B4/8:1 r/16 E4:1 C5:3 B4:2 | A4/4.:1 |
L: r/8 | r/4. | A2/16:5 E3:2 A3:1 r/8. | E2/16:5 E3:2 G#3:1 r/8. | A2/16:5 E3:2 A3:1 r/8. |
L: r/4. | A2/16:5 E3:2 A3:1 r/8. | E2/16:5 E3:2 G#3:1 r/8. | A2/16:5 E3:2 A3:1 r/8. |
L: C3/16:5 G3:2 C4:1 r/8. | G2/16:5 G3:2 B3:1 r/8. | A2/16:5 E3:2 A3:1 r/8. | r/8 E2/16:5 E3:1 r/8 |
L: r/4. | r/4. | A2/16:5 E3:2 A3:1 r/8. | E2/16:5 E3:2 G#3:1 r/8. | A2/16:5 E3:2 A3:1 r/8. |
L: r/4. | A2/16:5 E3:2 A3:1 r/8. | E2/16:5 E3:2 G#3:1 r/8. | A2/16:5 E3:2 A3:1 r/8. |
`,
  },
  {
    id: 'row-your-boat',
    text: `
title: Row, Row, Row Your Boat
title_ru: Row, Row, Row Your Boat
composer: Traditional (USA, 1852)
composer_ru: Американская народная, 1852
time: 6/8
tempo: 92
difficulty: 1
R: @A C4/4.:1 C4/4. | C4/4 D4/8:2 E4/4.:3 | E4/4:3 D4/8:2 E4/4:3 F4/8:4 | G4/2.:5 |
R: @B C5/8:5 C5 C5 G4:3 G4 G4 | E4:2 E4 E4 C4:1 C4 C4 | G4/4:5 F4/8:4 E4/4:3 D4/8:2 | C4/2.:1 |
`,
  },
  {
    id: 'brahms-lullaby',
    text: `
title: Lullaby (Wiegenlied), Op. 49 No. 4
title_ru: Колыбельная, соч. 49 № 4
composer: Johannes Brahms (1868)
composer_ru: Иоганнес Брамс, 1868
time: 3/4
tempo: 76
pickup: 1
difficulty: 2
R: E4/8:1 E4 | @A G4/4.:3 E4/8:1 E4/4 | G4/2:3 E4/8:1 G4:3 | C5/4:5 B4/4.:4 A4/8:3 | A4/4:3 G4:2 D4/8:1 E4:2 |
R: F4/4:3 D4:1 D4/8:1 E4:2 | F4/2:3 D4/8:1 F4:2 | B4/8:4 A4:3 G4/4:2 B4:4 | C5/2:5 C4/8:1 C4 |
R: @B C5/2:5 A4/8:3 F4:1 | G4/2:3 E4/8:2 C4:1 | F4/4:2 G4:3 A4:4 | G4/2:3 C4/8:1 C4 |
R: C5/2:5 A4/8:3 F4:1 | G4/2:3 E4/8:2 C4:1 | F4/4:4 E4:3 D4:2 | C4/2:1 |
`,
  },
  {
    id: 'minuet-g',
    text: `
title: Minuet in G major, BWV Anh. 114
title_ru: Менуэт соль мажор, BWV Anh. 114
composer: Christian Petzold (c. 1725), from the Notebook for Anna Magdalena Bach
composer_ru: Кристиан Петцольд, около 1725, из Нотной тетради Анны Магдалены Бах
time: 3/4
tempo: 104
difficulty: 2
R: @A D5/4:5 G4/8:1 A4:2 B4:3 C5:4 | D5/4:5 G4:1 G4 | E5/4:3 C5/8:1 D5:2 E5:3 F#5:4 | G5/4:5 G4:1 G4 |
R: C5/4:4 D5/8:5 C5:4 B4:3 A4:2 | B4/4:3 C5/8:4 B4:3 A4:2 G4:1 | F#4/4:2 G4/8:1 A4:2 B4:3 G4:1 | A4/2.:2 |
R: D5/4:5 G4/8:1 A4:2 B4:3 C5:4 | D5/4:5 G4:1 G4 | E5/4:3 C5/8:1 D5:2 E5:3 F#5:4 | G5/4:5 G4:1 G4 |
R: C5/4:4 D5/8:5 C5:4 B4:3 A4:2 | B4/4:3 C5/8:4 B4:3 A4:2 G4:1 | A4/4:3 B4/8:4 A4:3 G4:2 F#4:1 | G4/2.:2 |
`,
  },
  {
    id: 'korobeiniki',
    text: `
title: Korobeiniki
title_ru: Коробейники
composer: Russian folk song (words by Nikolay Nekrasov, 1861)
composer_ru: Русская народная песня на стихи Николая Некрасова, 1861
time: 4/4
tempo: 104
difficulty: 2
R: @A E5/4:5 B4/8:2 C5:3 D5/4:4 C5/8:3 B4:2 | A4/4:1 A4/8:1 C5:3 E5/4:5 D5/8:4 C5:3 | B4/4.:2 C5/8:3 D5/4:4 E5:5 | C5/4:3 A4:1 A4/2:1 |
R: @B r/8 D5/4:2 F5/8:3 A5/4:5 G5/8:4 F5:3 | E5/4.:2 C5/8:1 E5/4:3 D5/8:2 C5:1 | B4/4:1 B4/8:1 C5:2 D5/4:3 E5:4 | C5/4:2 A4:1 A4/2:1 |
`,
  },
];
