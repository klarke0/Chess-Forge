import React, { useState, useRef } from 'react';
import { Upload, X, FileText } from 'lucide-react';
import { cn } from '../utils/cn';

interface Props {
  onClose: () => void;
  onImport: (pgn: string, name: string, side: 'white' | 'black') => void;
  isProcessing: boolean;
}

export const PgnImportModal: React.FC<Props> = ({ onClose, onImport, isProcessing }) => {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [side, setSide] = useState<'white' | 'black'>('white');
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pgn') && file.type !== 'application/x-chess-pgn') return;
    const content = await file.text();
    setText(content);
    if (!name) setName(file.name.replace(/\.pgn$/i, ''));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file);
  };

  const canImport = text.trim() && name.trim() && !isProcessing;

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d1117] border border-white/10 rounded-[2.5rem] p-8 w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-black text-white uppercase tracking-wider text-sm flex items-center gap-2">
            <FileText size={16} className="text-indigo-400" /> Import PGN Repertoire
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Repertoire name */}
        <div className="mb-4">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
            Repertoire Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. King's Indian Defense"
            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
          />
        </div>

        {/* Side selector */}
        <div className="mb-4">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
            Playing as
          </label>
          <div className="flex gap-2">
            {(['white', 'black'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={cn(
                  'flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all',
                  side === s
                    ? s === 'white'
                      ? 'bg-slate-100 text-slate-900 border-slate-300'
                      : 'bg-slate-800 text-slate-100 border-slate-600'
                    : 'bg-transparent text-slate-500 border-white/10 hover:border-white/20'
                )}
              >
                {s === 'white' ? '♔ White' : '♚ Black'}
              </button>
            ))}
          </div>
        </div>

        {/* File upload */}
        <input ref={fileRef} type="file" accept=".pgn" className="hidden" onChange={handleFile} />
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file) readFile(file); }}
          className={cn(
            'w-full border-2 border-dashed rounded-2xl py-5 text-slate-400 hover:text-white hover:border-indigo-500/40 transition-all text-sm font-bold mb-4 flex items-center justify-center gap-2 cursor-pointer',
            isDragging ? 'border-indigo-500/60 bg-indigo-500/5 text-white' : 'border-white/10'
          )}
        >
          <Upload size={16} /> Drop .pgn file here or click to browse
        </div>

        <p className="text-center text-slate-600 text-xs uppercase tracking-widest my-3">or paste PGN</p>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'[Event "..."]\n[White "..."]\n\n1. d4 ...'}
          rows={5}
          className="w-full bg-black/30 border border-white/10 rounded-2xl p-4 text-sm text-slate-300 font-mono resize-none focus:outline-none focus:border-indigo-500/50"
        />

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-2xl font-bold text-sm transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => canImport && onImport(text.trim(), name.trim(), side)}
            disabled={!canImport}
            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-2xl font-bold text-sm transition-all"
          >
            {isProcessing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
};
