import React, { useState } from 'react';
import { BookOpen, Upload } from 'lucide-react';
import { ChapterLibrary } from './ChapterLibrary';
import { PgnImportModal } from './PgnImportModal';
import { useRepertoireStore } from '../stores/repertoireStore';
import { PgnParser, convertParsedGamesToRepertoire } from '../services/pgn_parser';
import * as api from '../services/api';

interface LibraryTabProps {
  onSelectChapter: (idx: number) => void;
}

export const LibraryTab: React.FC<LibraryTabProps> = ({ onSelectChapter }) => {
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const loadFromApi = useRepertoireStore(s => s.loadFromApi);

  const handleImport = async (pgn: string, name: string, side: 'white' | 'black') => {
    setImporting(true);
    setImportError(null);
    try {
      const games = PgnParser.parse(pgn);
      if (games.length === 0) {
        setImportError('No valid games found in PGN. Check the format and try again.');
        return;
      }

      const payload = convertParsedGamesToRepertoire(games, name, side);
      await api.importRepertoire(payload);

      // Reload the library and switch to the newly imported repertoire
      await loadFromApi();
      setShowImport(false);
    } catch (e: any) {
      setImportError(e?.message ?? 'Import failed. Check the server and try again.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#050507]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-amber-400" />
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-300">Library</h2>
        </div>
        <button
          onClick={() => { setShowImport(true); setImportError(null); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/20 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
        >
          <Upload size={12} /> Import PGN
        </button>
      </div>

      {/* Chapter Library */}
      <div className="flex-1 overflow-hidden">
        <ChapterLibrary
          onSelectChapter={onSelectChapter}
          onClose={() => {}}
        />
      </div>

      {showImport && (
        <PgnImportModal
          onClose={() => setShowImport(false)}
          onImport={handleImport}
          isProcessing={importing}
        />
      )}

      {/* Error toast */}
      {importError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-rose-900/90 border border-rose-500/30 text-rose-200 text-xs font-bold px-5 py-3 rounded-2xl shadow-2xl z-[300] max-w-sm text-center">
          {importError}
        </div>
      )}
    </div>
  );
};
