import { useSettingsStore } from '../stores/settingsStore';

const SOUNDS = {
  move:    'https://images.chesscomfiles.com/chess-themes/sounds/_standard/default/move-self.mp3',
  capture: 'https://images.chesscomfiles.com/chess-themes/sounds/_standard/default/capture.mp3',
  check:   'https://images.chesscomfiles.com/chess-themes/sounds/_standard/default/check.mp3',
  wrong:   'https://images.chesscomfiles.com/chess-themes/sounds/_standard/default/illegal.mp3',
} as const;

type SoundType = keyof typeof SOUNDS;
const audioCache: Partial<Record<SoundType, HTMLAudioElement>> = {};

function getAudio(type: SoundType): HTMLAudioElement {
  if (!audioCache[type]) {
    audioCache[type] = new Audio(SOUNDS[type]);
  }
  return audioCache[type]!;
}

export function useSound() {
  const soundEnabled = useSettingsStore(s => s.sound.enabled);

  const playSound = (type: SoundType) => {
    if (!soundEnabled) return;
    const audio = getAudio(type);
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };

  return { playSound };
}
