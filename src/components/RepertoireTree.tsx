import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Target, X, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../utils/cn';
import { Chessboard } from 'react-chessboard';
import { useRepertoireStore } from '../stores/repertoireStore';

interface TreeNode {
  fen: string;
  san: string;
  comment?: string;
  children: TreeNode[];
  mastery: 'mastered' | 'learning' | 'weak' | 'undrilled';
}

interface RepertoireTreeProps {
  positions: any;
  onClose: () => void;
  onJumpToPosition: (fen: string) => void;
}

const MasteryBadge: React.FC<{ mastery: TreeNode['mastery'] }> = ({ mastery }) => {
  const styles = {
    mastered: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
    learning: "bg-indigo-500/20 text-indigo-400 border-indigo-500/40",
    weak: "bg-rose-500/20 text-rose-400 border-rose-500/40",
    undrilled: "bg-white/10 text-slate-400 border-white/10"
  };

  return (
    <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border shadow-sm", styles[mastery])}>
      {mastery}
    </span>
  );
};

const TreeItem: React.FC<{ 
  node: TreeNode; 
  depth: number; 
  onJump: (fen: string) => void;
  onHover: (fen: string | null) => void;
  forceState?: boolean | null;
}> = ({ node, depth, onJump, onHover, forceState }) => {
  const [isOpen, setIsOpen] = useState(depth < 1);

  useEffect(() => {
    if (forceState !== null && forceState !== undefined) {
      setIsOpen(forceState);
    }
  }, [forceState]);

  return (
    <div className="select-none">
      <div 
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => onHover(node.fen)}
        onMouseLeave={() => onHover(null)}
        className={cn(
          "flex items-center gap-3 py-3 px-4 rounded-xl transition-all cursor-pointer group border border-transparent",
          isOpen ? "bg-[#1a1f26] border-white/5 shadow-inner" : "hover:bg-[#161b22] hover:border-white/5"
        )}
      >
        <div className="flex items-center gap-2 min-w-[80px]">
          {node.children.length > 0 ? (
            isOpen ? <ChevronDown size={14} className="text-indigo-400" /> : <ChevronRight size={14} className="text-slate-500" />
          ) : (
            <div className="w-[14px]" />
          )}
          <span className="font-mono text-[10px] font-black text-slate-500">{Math.floor(depth/2) + 1}.{depth % 2 === 0 ? '' : '..'}</span>
          <span className="font-bold text-slate-100 group-hover:text-indigo-400 transition-colors">{node.san}</span>
        </div>

        <div className="flex-1 flex items-center gap-4 overflow-hidden">
          <MasteryBadge mastery={node.mastery} />
          {node.comment && (
            <span className="text-[10px] text-slate-400 truncate italic max-w-[400px]">"{node.comment}"</span>
          )}
        </div>

        <button 
          onClick={(e) => {
            e.stopPropagation();
            onJump(node.fen);
          }}
          className="opacity-0 group-hover:opacity-100 p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all shadow-lg flex items-center gap-2 text-[8px] font-black uppercase"
        >
          <Target size={14} /> Train
        </button>
      </div>

      {isOpen && node.children.length > 0 && (
        <div className="ml-6 mt-1 border-l-2 border-white/10 pl-2 space-y-1">
          {node.children.map((child, idx) => (
            <TreeItem key={idx} node={child} depth={depth + 1} onJump={onJump} onHover={onHover} forceState={forceState} />
          ))}
        </div>
      )}
    </div>
  );
};

export const RepertoireTree: React.FC<RepertoireTreeProps> = ({ positions, onClose, onJumpToPosition }) => {
  const { repertoireSide } = useRepertoireStore();
  const [previewFen, setPreviewFen] = useState<string | null>(null);
  const [globalExpand, setGlobalExpand] = useState<boolean | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, string>>({});
  const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  useEffect(() => {
    const id = useRepertoireStore.getState().repertoireId;
    if (!id) return;
    fetch(`/api/progress/${id}`)
      .then(r => r.json())
      .then((rows: any[]) => {
        const map: Record<string, string> = {};
        for (const row of rows) {
          map[row.fen] = row.streak >= 3 ? 'mastered'
            : row.streak >= 1 ? 'learning'
            : row.total_attempts > 0 ? 'weak'
            : 'undrilled';
        }
        setProgressMap(map);
      })
      .catch(() => {});
  }, []);

  const buildTree = (fen: string, depth: number = 0, maxDepth: number = 6, pMap: Record<string, string> = {}): TreeNode[] => {
    if (depth > maxDepth) return [];
    const moves = positions[fen] || [];
    return moves.map((m: any) => ({
      fen: m.nextFen,
      san: m.san,
      comment: m.comment,
      mastery: (pMap[m.nextFen] as TreeNode['mastery']) || 'undrilled',
      children: buildTree(m.nextFen, depth + 1, maxDepth, pMap)
    }));
  };

  const treeData = buildTree(initialFen, 0, 6, progressMap);

  return (
    <div className="fixed inset-0 z-[90] bg-[#050507] flex font-outfit animate-in slide-in-from-bottom-4 duration-500">
      
      {/* Left Column: Tree List */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-white/5">
        <div className="flex justify-between items-start lg:items-center p-4 lg:p-8 border-b border-white/5 bg-[#0a0d14] shrink-0">
          <div>
            <h2 className="text-2xl lg:text-3xl font-black text-white uppercase italic tracking-tighter">Knowledge Tree</h2>
            <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4 mt-2">
              <p className="text-slate-400 font-bold uppercase tracking-[0.3em] text-[10px]">Visual Repertoire Explorer</p>
              <div className="hidden lg:block h-3 w-[1px] bg-white/10" />
              <div className="flex gap-4">
                <button onClick={() => setGlobalExpand(true)} className="text-[10px] font-bold text-slate-500 hover:text-indigo-400 uppercase tracking-widest flex items-center gap-1">
                  <Maximize2 size={10} /> Expand
                </button>
                <button onClick={() => setGlobalExpand(false)} className="text-[10px] font-bold text-slate-500 hover:text-indigo-400 uppercase tracking-widest flex items-center gap-1">
                  <Minimize2 size={10} /> Collapse
                </button>
              </div>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors"
            aria-label="Close Tree"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="space-y-2">
            {treeData.map((node, idx) => (
              <TreeItem 
                key={idx} 
                node={node} 
                depth={0} 
                onJump={onJumpToPosition} 
                onHover={setPreviewFen} 
                forceState={globalExpand}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right Column: Preview Board (Desktop Only) */}
      <div className="hidden lg:flex w-[450px] bg-[#080a0f] flex-col items-center justify-center p-8 border-l border-white/5 shadow-2xl relative">
        <div className="w-full aspect-square bg-[#161b22] rounded-[2rem] overflow-hidden border-[12px] border-[#161b22] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)]">
          <Chessboard 
            position={previewFen || initialFen} 
            arePiecesDraggable={false} 
            animationDuration={200}
            boardOrientation={repertoireSide}
            customDarkSquareStyle={{ backgroundColor: '#1e293b' }}
            customLightSquareStyle={{ backgroundColor: '#475569' }}
          />
        </div>
        
        <div className="mt-8 text-center">
          <h3 className="text-white font-black uppercase tracking-widest text-sm mb-2">
            {previewFen ? 'Variation Preview' : 'Starting Position'}
          </h3>
          <p className="text-slate-500 text-xs font-medium max-w-[280px] leading-relaxed">
            Hover over any move in the tree to visualize the resulting board state instantly.
          </p>
        </div>
      </div>

    </div>
  );
};
