import React from 'react';
import { X, Moon, Sun } from 'lucide-react';
import { useSettingsStore, Theme, BoardColorScheme } from '../stores/settingsStore';
import { cn } from '../utils/cn';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const Toggle: React.FC<{ label: string; description?: string; value: boolean; onChange: () => void }> = ({
  label, description, value, onChange,
}) => (
  <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
    <div>
      <p className="text-sm font-bold text-white">{label}</p>
      {description && <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>}
    </div>
    <button
      onClick={onChange}
      className={cn(
        "relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0",
        value ? "bg-orange-600" : "bg-white/10"
      )}
    >
      <span className={cn(
        "absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200",
        value ? "translate-x-5" : "translate-x-1"
      )} />
    </button>
  </div>
);

const SectionHeader: React.FC<{ label: string }> = ({ label }) => (
  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3 mt-6 first:mt-0">{label}</p>
);

const BOARD_SCHEMES: { id: BoardColorScheme; label: string; dark: string; light: string }[] = [
  { id: 'slate',  label: 'Slate',  dark: '#1e293b', light: '#475569' },
  { id: 'green',  label: 'Green',  dark: '#769656', light: '#eeeed2' },
  { id: 'blue',   label: 'Blue',   dark: '#4f7eba', light: '#dce7f5' },
  { id: 'walnut', label: 'Walnut', dark: '#a07753', light: '#e0c494' },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const {
    appearance, setTheme,
    sound, toggleSound,
    training, toggleAutoProceed, toggleTrainingVision,
    board, setBoardSetting,
    engine, setEngineLines, setEngineDepth,
  } = useSettingsStore();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      <div className={cn(
        "fixed top-0 right-0 h-full w-80 bg-[#0d1117] border-l border-white/10 z-[100] flex flex-col shadow-2xl transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "translate-x-full"
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-base font-black text-white uppercase tracking-widest">Settings</h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Chess Forge</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <SectionHeader label="Appearance" />
          <div className="mb-4">
            <p className="text-sm font-bold text-white mb-2">Theme</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'dark' as Theme,  label: 'Dark',  Icon: Sun },
                { id: 'night' as Theme, label: 'Night', Icon: Moon },
              ]).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  className={cn(
                    "flex flex-col items-center gap-2 py-3 rounded-xl border transition-all text-xs font-bold uppercase tracking-widest",
                    appearance.theme === id
                      ? "bg-orange-600/20 border-orange-500/50 text-orange-400"
                      : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                  )}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-600 mt-2 leading-relaxed">
              More themes coming soon — Forge, Amber, and Light.
            </p>
          </div>

          <SectionHeader label="Audio" />
          <Toggle
            label="Sound Effects"
            description="Move, capture, and error sounds"
            value={sound.enabled}
            onChange={toggleSound}
          />

          <SectionHeader label="Training" />
          <Toggle
            label="Auto-Proceed"
            description="Automatically advance after a correct move (500ms delay)"
            value={training.autoProceed}
            onChange={toggleAutoProceed}
          />
          <Toggle
            label="Vision Overlay"
            description="Show square control map on the training board"
            value={training.showVision}
            onChange={toggleTrainingVision}
          />

          <SectionHeader label="Board" />
          <div className="mb-4">
            <p className="text-sm font-bold text-white mb-2">Color Scheme</p>
            <div className="grid grid-cols-2 gap-2">
              {BOARD_SCHEMES.map((scheme) => (
                <button
                  key={scheme.id}
                  onClick={() => setBoardSetting('colorScheme', scheme.id)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all",
                    board.colorScheme === scheme.id
                      ? "border-orange-500/50 bg-orange-600/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  )}
                >
                  <div className="flex gap-0.5 shrink-0">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: scheme.dark }} />
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: scheme.light }} />
                  </div>
                  <span className={cn(
                    "text-xs font-bold uppercase tracking-wider",
                    board.colorScheme === scheme.id ? "text-orange-400" : "text-slate-400"
                  )}>{scheme.label}</span>
                </button>
              ))}
            </div>
          </div>
          <Toggle
            label="Coordinates"
            description="Show a–h and 1–8 on board edges"
            value={board.showCoordinates}
            onChange={() => setBoardSetting('showCoordinates', !board.showCoordinates)}
          />
          <Toggle
            label="Animate Pieces"
            description="Smooth piece movement animations"
            value={board.animatePieces}
            onChange={() => setBoardSetting('animatePieces', !board.animatePieces)}
          />

          <SectionHeader label="Engine" />
          <div className="mb-4">
            <p className="text-sm font-bold text-white mb-2">Analysis Lines</p>
            <div className="flex gap-2">
              {([1, 2, 3] as (1 | 2 | 3)[]).map((n) => (
                <button
                  key={n}
                  onClick={() => setEngineLines(n)}
                  className={cn(
                    "flex-1 py-2 rounded-xl border text-sm font-black transition-all",
                    engine.lines === n
                      ? "bg-orange-600/20 border-orange-500/50 text-orange-400"
                      : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-6">
            <p className="text-sm font-bold text-white mb-2">Search Depth</p>
            <div className="flex gap-2">
              {([
                { val: 16 as 16 | 20 | 24, label: 'Fast' },
                { val: 20 as 16 | 20 | 24, label: 'Balanced' },
                { val: 24 as 16 | 20 | 24, label: 'Deep' },
              ]).map(({ val, label }) => (
                <button
                  key={val}
                  onClick={() => setEngineDepth(val)}
                  className={cn(
                    "flex-1 py-2 rounded-xl border text-xs font-black uppercase tracking-wide transition-all",
                    engine.depth === val
                      ? "bg-orange-600/20 border-orange-500/50 text-orange-400"
                      : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/5 shrink-0">
          <p className="text-[10px] text-slate-600 text-center font-bold uppercase tracking-widest">
            Chess Forge · Settings are saved automatically
          </p>
        </div>
      </div>
    </>
  );
};
