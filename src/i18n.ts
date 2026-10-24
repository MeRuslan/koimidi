/** Two languages, one flat dictionary each. `t()` interpolates {name} placeholders. */
import type { Lang } from './storage/settings';

export const dict = {
  en: {
    'app.tagline': 'Free piano trainer for your MIDI keyboard',
    'app.sub': 'Falling notes with finger numbers. Waits for the right key. Makes sound for keyboards that have none.',
    'facts.free': 'Free',
    'facts.noSignup': 'No sign-up',
    'facts.local': 'Files never leave your browser',
    'open.button': 'Open MIDI or MusicXML',
    'open.drop': 'or drop a file anywhere on this page',
    'open.formats': '.mid, .midi, .musicxml, .xml, .mxl. Parsed on this device, nothing is uploaded.',
    'open.reading': 'Reading {name}…',
    'open.failed': 'Could not open {name}: {reason}',
    'open.unknownType': 'not a MIDI or MusicXML file',
    'recent.title': 'Your files',
    'recent.note': 'Stored only in this browser. Clearing site data removes them.',
    'recent.remove': 'Remove',
    'recent.removeConfirm': 'Remove "{title}" from this browser?',
    'library.title': 'Library',
    'library.note': 'Public-domain pieces, typeset for koimidi.',
    'piece.bars': '{n} bars',
    'piece.bars.one': '{n} bar',
    'piece.barsRange': 'bars {from}–{to}',
    'piece.hands.R': 'right hand',
    'piece.hands.L': 'left hand',
    'piece.hands.both': 'both hands',
    'difficulty.1': 'easy',
    'difficulty.2': 'medium',
    'difficulty.3': 'harder',
    'midi.unsupported': 'This browser cannot see MIDI keyboards. Use Chrome, Edge, Brave or Opera, or play with the computer keys.',
    'midi.requesting': 'Looking for a MIDI keyboard…',
    'midi.denied': 'MIDI access is blocked. Allow it from the icon in the address bar and reload.',
    'midi.none': 'No MIDI keyboard found. Plug one in, or use the computer keys A–L.',
    'midi.connected': '{names}',
    'midi.short.unsupported': 'No Web MIDI',
    'midi.short.none': 'No keyboard',
    'midi.short.denied': 'MIDI blocked',
    'midi.short.requesting': 'MIDI…',
    'mode.learn': 'Learn',
    'mode.tempo': 'In tempo',
    'mode.listen': 'Listen',
    'mode.learn.hint': 'Time stops on each note until you play it.',
    'mode.tempo.hint': 'Notes keep coming; late or wrong ones count as mistakes.',
    'mode.listen.hint': 'The piece plays itself so you can hear it.',
    'tempo': 'Tempo',
    'bars': 'Bars',
    'bars.all': 'all',
    'loop': 'Loop',
    'play': 'Start',
    'pause': 'Pause',
    'restart': 'Restart',
    'back': 'Library',
    'settings': 'Settings',
    'sections': 'Sections',
    'hand.R': 'Right',
    'hand.L': 'Left',
    'hand.both': 'Both',
    'hud.next': 'Next',
    'hud.finger': 'finger',
    'hud.chord': 'chord',
    'hud.measure': 'bar {m} of {n}',
    'hud.stats': 'correct {hits} · wrong {wrong}',
    'hud.statsMissed': ' · missed {misses}',
    'hud.listen': 'Listen first, then try it yourself in Learn mode.',
    'hud.ended': 'End of the piece',
    'hud.pressToStart': 'Play the highlighted key to start, or press Start.',
    'hint.waiting': 'waiting for your key',
    'hint.wrong': 'Play {note}, finger {f} ({fname})',
    'hint.wrongChord': 'Play {notes}',
    'hint.octave': 'You are playing {n} {dir} the notes on screen. Press OCTAVE {arrow} on your keyboard, or keep going: it counts.',
    'hint.octave.one': 'one octave',
    'hint.octave.many': '{n} octaves',
    'hint.octave.lower': 'below',
    'hint.octave.higher': 'above',
    'hint.done': 'Done: {hits} correct, {wrong} wrong{missed}.',
    'hint.doneMissed': ', {misses} missed',
    'hint.sectionDone': 'Bars {from}–{to} done: {hits} correct, {wrong} wrong{missed}.',
    'hint.fingersAuto': 'Fingering was computed automatically.',
    'finger.1': 'thumb',
    'finger.2': 'index',
    'finger.3': 'middle',
    'finger.4': 'ring',
    'finger.5': 'pinky',
    'legend.left': 'left hand bars are dimmer',
    'shortcuts': 'Keys A–L and W E T Y U O play notes · Z X octave · Space start/pause · Enter restart · [ ] loop start/end · Esc back',
    'settings.sound': 'Sound of my keys',
    'settings.volume': 'Volume',
    'settings.anyOctave': 'Accept the same note in any octave',
    'settings.noteNames': 'Note names',
    'settings.noteNames.auto': 'by language',
    'settings.noteNames.solfege': 'do re mi',
    'settings.noteNames.letters': 'C D E',
    'settings.midiSplit': 'Left hand in MIDI files',
    'settings.midiSplit.auto': 'detect',
    'settings.midiSplit.none': 'none, one hand',
    'settings.midiSplit.middleC': 'notes below middle C',
    'settings.lang': 'Language',
    'settings.reset': 'Forget my settings for this piece',
    'browser.hint': 'Web MIDI works in Chrome, Edge, Brave and Opera on a computer or Android. Safari and Firefox do not support it.',
    'footer.license': 'MIT license',
    'footer.source': 'Source on GitHub',
    'footer.privacy': 'No account, no analytics, no uploads.',
    'autoFingers': 'fingers computed',
    'fileFingers': 'fingers from file',
    'audio.unlock': 'Click or tap the page once to enable sound.',
    'continue': 'continue',
    'storage.saved': 'Saved in this browser',
  },
  ru: {
    'app.tagline': 'Бесплатный тренажёр для MIDI-клавиатуры',
    'app.sub': 'Падающие ноты с номерами пальцев. Ждёт верного нажатия. Озвучивает клавиатуры без своего звука.',
    'facts.free': 'Бесплатно',
    'facts.noSignup': 'Без регистрации',
    'facts.local': 'Файлы не покидают браузер',
    'open.button': 'Открыть MIDI или MusicXML',
    'open.drop': 'или перетащите файл на страницу',
    'open.formats': '.mid, .midi, .musicxml, .xml, .mxl. Разбирается на этом устройстве, ничего не загружается на сервер.',
    'open.reading': 'Читаю {name}…',
    'open.failed': 'Не удалось открыть {name}: {reason}',
    'open.unknownType': 'это не MIDI и не MusicXML',
    'recent.title': 'Ваши файлы',
    'recent.note': 'Хранятся только в этом браузере. Очистка данных сайта их удалит.',
    'recent.remove': 'Удалить',
    'recent.removeConfirm': 'Удалить «{title}» из этого браузера?',
    'library.title': 'Библиотека',
    'library.note': 'Пьесы из общественного достояния в собственном наборе koimidi.',
    'piece.bars': '{n} тактов',
    'piece.bars.one': '{n} такт',
    'piece.bars.few': '{n} такта',
    'piece.barsRange': 'такты {from}–{to}',
    'piece.hands.R': 'правая рука',
    'piece.hands.L': 'левая рука',
    'piece.hands.both': 'две руки',
    'difficulty.1': 'легко',
    'difficulty.2': 'средне',
    'difficulty.3': 'сложнее',
    'midi.unsupported': 'Этот браузер не видит MIDI-клавиатуры. Откройте в Chrome, Edge, Brave или Opera — или играйте клавишами компьютера.',
    'midi.requesting': 'Ищу MIDI-клавиатуру…',
    'midi.denied': 'Доступ к MIDI заблокирован. Разрешите его по значку в адресной строке и перезагрузите страницу.',
    'midi.none': 'MIDI-клавиатура не найдена. Подключите её или играйте клавишами компьютера A–L.',
    'midi.connected': '{names}',
    'midi.short.unsupported': 'Нет Web MIDI',
    'midi.short.none': 'Нет клавиатуры',
    'midi.short.denied': 'MIDI закрыт',
    'midi.short.requesting': 'MIDI…',
    'mode.learn': 'Учить',
    'mode.tempo': 'В темпе',
    'mode.listen': 'Послушать',
    'mode.learn.hint': 'Время замирает на каждой ноте, пока вы её не сыграете.',
    'mode.tempo.hint': 'Ноты идут без остановки; опоздания и ошибки считаются.',
    'mode.listen.hint': 'Пьеса играет сама, чтобы вы услышали, как должно звучать.',
    'tempo': 'Темп',
    'bars': 'Такты',
    'bars.all': 'все',
    'loop': 'Повтор',
    'play': 'Начать',
    'pause': 'Пауза',
    'restart': 'Заново',
    'back': 'Библиотека',
    'settings': 'Настройки',
    'sections': 'Разделы',
    'hand.R': 'Правая',
    'hand.L': 'Левая',
    'hand.both': 'Обе',
    'hud.next': 'Следующая',
    'hud.finger': 'палец',
    'hud.chord': 'аккорд',
    'hud.measure': 'такт {m} из {n}',
    'hud.stats': 'верно {hits} · ошибок {wrong}',
    'hud.statsMissed': ' · пропущено {misses}',
    'hud.listen': 'Сначала послушайте, потом попробуйте сами в режиме «Учить».',
    'hud.ended': 'Мелодия закончилась',
    'hud.pressToStart': 'Нажмите подсвеченную клавишу, чтобы начать, или кнопку «Начать».',
    'hint.waiting': 'жду ваше нажатие',
    'hint.wrong': 'Нужна {note}, палец {f} ({fname})',
    'hint.wrongChord': 'Нужны {notes}',
    'hint.octave': 'Вы играете на {n} {dir} нот на экране. Нажмите OCTAVE {arrow} на клавиатуре — или оставьте так, засчитывается.',
    'hint.octave.one': 'октаву',
    'hint.octave.many': '{n} октавы',
    'hint.octave.lower': 'ниже',
    'hint.octave.higher': 'выше',
    'hint.done': 'Готово: верно {hits}, ошибок {wrong}{missed}.',
    'hint.doneMissed': ', пропущено {misses}',
    'hint.sectionDone': 'Такты {from}–{to} пройдены: верно {hits}, ошибок {wrong}{missed}.',
    'hint.fingersAuto': 'Аппликатура расставлена автоматически.',
    'finger.1': 'большой',
    'finger.2': 'указательный',
    'finger.3': 'средний',
    'finger.4': 'безымянный',
    'finger.5': 'мизинец',
    'legend.left': 'полоски левой руки приглушены',
    'shortcuts': 'Клавиши A–L и W E T Y U O играют ноты · Z X октава · Пробел старт/пауза · Enter заново · [ ] начало/конец повтора · Esc назад',
    'settings.sound': 'Звук моих клавиш',
    'settings.volume': 'Громкость',
    'settings.anyOctave': 'Засчитывать ту же ноту в любой октаве',
    'settings.noteNames': 'Названия нот',
    'settings.noteNames.auto': 'по языку',
    'settings.noteNames.solfege': 'до ре ми',
    'settings.noteNames.letters': 'C D E',
    'settings.midiSplit': 'Левая рука в MIDI-файлах',
    'settings.midiSplit.auto': 'определять',
    'settings.midiSplit.none': 'нет, одна рука',
    'settings.midiSplit.middleC': 'ноты ниже до первой октавы',
    'settings.lang': 'Язык',
    'settings.reset': 'Забыть настройки этой пьесы',
    'browser.hint': 'Web MIDI работает в Chrome, Edge, Brave и Opera на компьютере и Android. Safari и Firefox его не поддерживают.',
    'footer.license': 'Лицензия MIT',
    'footer.source': 'Исходники на GitHub',
    'footer.privacy': 'Без аккаунта, без аналитики, без загрузок на сервер.',
    'autoFingers': 'пальцы расставлены автоматически',
    'fileFingers': 'пальцы из файла',
    'audio.unlock': 'Нажмите на страницу один раз, чтобы включить звук.',
    'continue': 'продолжить',
    'storage.saved': 'Сохранено в этом браузере',
  },
} as const;

export type Key = keyof typeof dict.en;

let current: Lang = 'en';

export function detectLang(): Lang {
  const l = (navigator.language || '').toLowerCase();
  return l.startsWith('ru') || l.startsWith('be') || l.startsWith('uk') || l.startsWith('kk') || l.startsWith('ba') || l.startsWith('tt') ? 'ru' : 'en';
}

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
}

export function getLang(): Lang {
  return current;
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
  const table = dict[current] as Record<string, string>;
  let s = table[key] ?? (dict.en as Record<string, string>)[key] ?? key;
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const SOLFEGE_RU = ['до', 'до-диез', 'ре', 'ре-диез', 'ми', 'фа', 'фа-диез', 'соль', 'соль-диез', 'ля', 'си-бемоль', 'си'];
const SOLFEGE_EN = ['do', 'do♯', 're', 're♯', 'mi', 'fa', 'fa♯', 'sol', 'sol♯', 'la', 'si♭', 'si'];
const LETTERS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

export type NameStyle = 'solfege' | 'letters';

export function noteName(pitch: number, style: NameStyle): string {
  const pc = ((pitch % 12) + 12) % 12;
  if (style === 'letters') return LETTERS[pc];
  return (current === 'ru' ? SOLFEGE_RU : SOLFEGE_EN)[pc];
}

/** Short label for a white key: name plus octave number on C. */
export function keyLabel(pitch: number, style: NameStyle): string {
  const pc = ((pitch % 12) + 12) % 12;
  const name = noteName(pitch, style);
  if (pc === 0) return `${name}${Math.floor(pitch / 12) - 1}`;
  return name;
}

export function fingerName(f: number): string {
  return t(`finger.${f}` as Key);
}

/** Apply data-i18n attributes in a subtree. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as Key);
    el.setAttribute('aria-label', el.title);
  });
}

/** "{n} bars" with Russian plural forms. */
export function barsLabel(n: number): string {
  const table = dict[current] as Record<string, string>;
  const mod10 = n % 10;
  const mod100 = n % 100;
  let key: Key = 'piece.bars';
  if (current === 'ru') {
    if (mod10 === 1 && mod100 !== 11) key = 'piece.bars.one';
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) key = 'piece.bars.few' as Key;
  } else if (n === 1) key = 'piece.bars.one';
  if (!table[key]) key = 'piece.bars';
  return t(key, { n });
}
