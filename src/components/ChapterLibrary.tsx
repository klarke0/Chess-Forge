import React, { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import { Target, Play, Book, ChevronRight, ArrowLeft } from 'lucide-react';
import { useRepertoireStore } from '../stores/repertoireStore';
import { Chessboard } from 'react-chessboard';
import { cn } from '../utils/cn';

interface ChapterLibraryProps {
  onSelectChapter: (idx: number) => void;
  onClose?: () => void;
}

export const ChapterLibrary: React.FC<ChapterLibraryProps> = ({ onSelectChapter, onClose }) => {
  const { chapters, setShowChapters, repertoireName, availableRepertoires, setActiveRepertoire, repertoireId, repertoireSide } = useRepertoireStore();
  const [view, setView] = useState<'repertoires' | 'chapters'>('repertoires');
  const [hoveredChapter, setHoveredChapter] = useState<number | null>(null);
  const [previewStep, setPreviewStep] = useState(0);

  // Animated preview logic
  useEffect(() => {
    if (hoveredChapter === null) {
      setPreviewStep(0);
      return;
    }

    const chapter = chapters[hoveredChapter];
    if (!chapter?.startMoves || chapter.startMoves.length === 0) return;

    const interval = setInterval(() => {
      setPreviewStep((prev) => (prev + 1) % (chapter.startMoves.length + 1));
    }, 600); // Quick cycle through moves

    return () => clearInterval(interval);
  }, [hoveredChapter, chapters]);

  const _handleClose = () => {
    setShowChapters(false);
    if (onClose) onClose();
  };
  void _handleClose; 

  const handleSelectRepertoire = async (id: number) => {
    await setActiveRepertoire(id);
    setView('chapters');
  };

  const getPreviewFen = (chapter: any, step: number) => {
    const rootFen = chapter?.firstFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    if (!chapter?.startMoves || chapter.startMoves.length === 0 || step === 0) return rootFen;
    
    try {
      const g = new Chess(rootFen);
      const movesToPlay = chapter.startMoves.slice(0, step);
      for (const move of movesToPlay) {
        g.move(move);
      }
      return g.fen();
    } catch (e) {
      return rootFen;
    }
  };

  const getChapterCategory = (name: string) => {
    if (!name) return 'General Variations';
    
    // Check for "BOOK: Ch X" pattern
    const bookMatch = name.match(/^BOOK: (Ch \d+)/i);
    if (bookMatch) {
      return `Chapter ${bookMatch[1].replace(/ch\s+/i, '')}`;
    }

    if (name.startsWith('BOOK:')) return 'Official Book Studies';
    
    // For "Vol A: Flank Openings: Amar Opening", return "Vol A: Flank Openings"
    if (name.includes(':')) {
      const parts = name.split(':');
      if (parts.length >= 3) {
        return `${parts[0].trim()}: ${parts[1].trim()}`;
      }
      return parts[0].trim();
    }
    
    if (name.includes(' - ')) return name.split(' - ')[0].trim();
    return 'General Variations';
  };

  const renderChapterList = () => {
    const elements: React.ReactNode[] = [];
    let lastCategory = '';

    chapters.forEach((chapter, idx) => {
      const category = getChapterCategory(chapter.name);
      
      if (category !== lastCategory) {
        elements.push(
          <div key={`cat-${category}`} className="col-span-full mt-8 mb-4">
            <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.4em] border-b border-indigo-500/20 pb-2 mb-4">
              {category}
            </h4>
          </div>
        );
        lastCategory = category;
      }

      // Clean up the chapter name for display
      // 1. Remove "BOOK: Ch X - " prefix
      // 2. Remove "Vol X: Category: " prefix
      let displayName = chapter.name
        .replace(/^BOOK: Ch \d+ - /i, '')
        .replace(/^BOOK: /i, '');
      
      if (displayName.includes(':')) {
        const parts = displayName.split(':');
        displayName = parts[parts.length - 1].trim();
      }

      elements.push(
        <button
          key={idx}
          onClick={() => {
            onSelectChapter(idx);
          }}
          onMouseEnter={() => setHoveredChapter(idx)}
          onMouseLeave={() => setHoveredChapter(null)}
          className={cn(
            "p-6 bg-[#0d1117] border rounded-[2rem] text-left transition-all relative overflow-hidden group h-full",
            hoveredChapter === idx ? "bg-white/5 border-indigo-500/50 translate-x-1" : "border-white/5"
          )}
        >
          {/* Learn progress badge */}
          {(chapter.learnRuns ?? 0) > 0 && (
            <span className={cn(
              "absolute top-3 right-3 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border",
              (chapter.learnRuns ?? 0) >= 3
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : "text-amber-400 bg-amber-500/10 border-amber-500/20"
            )}>
              {(chapter.learnRuns ?? 0) >= 3 ? '✓ Mastered' : `${chapter.learnRuns}/3`}
            </span>
          )}
          <h3 className="text-lg font-bold text-white mb-3 group-hover:text-indigo-400 transition-colors leading-tight pr-8">
            {displayName}
          </h3>
          <div className="flex items-center gap-2 text-[9px] font-black text-slate-500 uppercase tracking-widest mt-auto">
            <Play size={10} fill="currentColor" className="text-indigo-500" /> Study & Learn Module
          </div>
        </button>
      );
    });

    return elements;
  };

  return (
    <div className="relative h-full p-12 bg-[#050507] overflow-y-auto animate-in fade-in duration-300 custom-scrollbar">
      <div className="max-w-6xl mx-auto h-full flex flex-col">
        <div className="flex justify-between items-center mb-16">
          <div className="flex items-center gap-4">
            {view === 'chapters' && (
              <button 
                onClick={() => setView('repertoires')}
                className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl text-slate-400 transition-all mr-4"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div>
              <h2 className="text-5xl font-black text-white uppercase tracking-tighter italic font-outfit">
                {view === 'repertoires' ? 'My Repertoires' : repertoireName}
              </h2>
              <p className="text-slate-500 font-bold uppercase tracking-[0.4em] text-[10px] mt-1">
                {view === 'repertoires' ? 'Select an opening to train' : 'Select a variation module'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1">
          {view === 'repertoires' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 overflow-y-auto pr-4 custom-scrollbar">
              {availableRepertoires.map((rep) => (
                <button
                  key={rep.id}
                  onClick={() => handleSelectRepertoire(rep.id)}
                  className={cn(
                    "group p-10 bg-[#0d1117] border rounded-[3rem] text-left transition-all hover:bg-white/5 relative overflow-hidden shadow-2xl",
                    repertoireId === rep.id ? "border-indigo-500/50 ring-1 ring-indigo-500/20" : "border-white/5"
                  )}
                >
                  <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity text-white">
                    <Book size={200} />
                  </div>
                  <div className="flex items-center gap-4 mb-6">
                    <div className={cn(
                      "p-4 rounded-2xl shadow-lg transition-transform group-hover:scale-110",
                      repertoireId === rep.id ? "bg-indigo-600 shadow-indigo-600/20" : "bg-slate-800"
                    )}>
                      <Book size={28} className="text-white" />
                    </div>
                    {repertoireId === rep.id && (
                      <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Active Repertoire</span>
                    )}
                  </div>
                  <h3 className="text-4xl font-black text-white mb-4 group-hover:text-indigo-400 transition-colors leading-tight italic">
                    {rep.name}
                  </h3>
                  <p className="text-slate-400 text-sm max-w-md mb-8 leading-relaxed font-medium">
                    {rep.description || `Complete training database for ${rep.name}. Analyze and drill variations.`}
                  </p>
                  <div className={cn(
                    "flex items-center gap-2 text-[10px] font-black uppercase tracking-widest w-fit px-6 py-3 rounded-xl border transition-all",
                    repertoireId === rep.id ? "bg-indigo-600 border-transparent text-white" : "bg-white/5 border-white/5 text-slate-400 group-hover:bg-white/10"
                  )}>
                    Browse Variations <ChevronRight size={14} />
                  </div>
                </button>
              ))}

              <div className="p-10 border-2 border-dashed border-white/5 rounded-[3rem] flex flex-col items-center justify-center text-center opacity-40 hover:opacity-60 transition-opacity cursor-pointer min-h-[300px]">
                <div className="w-16 h-16 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center mb-6">
                  <Target size={24} className="text-slate-500" />
                </div>
                <h4 className="text-xl font-bold text-slate-400 mb-2">Import Additional</h4>
                <p className="text-slate-600 text-xs uppercase tracking-widest font-black">Upload any PGN to expand your library</p>
              </div>
            </div>
          ) : (
            <div className="flex gap-12 h-full pb-12">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0 overflow-y-auto pr-4 custom-scrollbar content-start">
                {renderChapterList()}
              </div>

              <div className="hidden lg:block w-[400px] shrink-0">
                <div className="sticky top-0 bg-[#0d1117] border border-white/10 rounded-[3rem] p-8 shadow-2xl overflow-hidden aspect-square flex flex-col items-center justify-center">
                  {hoveredChapter !== null ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-6 animate-in fade-in zoom-in-95 duration-300">
                      <div className="w-full aspect-square rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#1a1f26]">
                        <Chessboard 
                          position={getPreviewFen(chapters[hoveredChapter], previewStep)} 
                          boardOrientation={repertoireSide}
                          arePiecesDraggable={false}
                          customDarkSquareStyle={{ backgroundColor: '#1e293b' }}
                          customLightSquareStyle={{ backgroundColor: '#475569' }}
                          animationDuration={200}
                        />
                      </div>
                      <div className="text-center h-12">
                        <h4 className="text-white font-bold mb-1 truncate w-64">{chapters[hoveredChapter].name.replace(/^BOOK: /, '')}</h4>
                        <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest animate-pulse">
                          {previewStep === 0 ? 'Starting Position' : `Move ${Math.ceil(previewStep/2)}: ${chapters[hoveredChapter].startMoves[previewStep-1]}`}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center p-12">
                      <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Target size={32} className="text-slate-700" />
                      </div>
                      <h4 className="text-slate-400 font-bold mb-2 uppercase tracking-tighter">Preview</h4>
                      <p className="text-slate-600 text-[10px] font-black uppercase tracking-widest">Hover over a variation to see the starting position</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
