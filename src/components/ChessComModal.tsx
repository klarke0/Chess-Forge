import React, { useState } from 'react';
import { X, Activity } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSync: (username: string) => void;
  isProcessing: boolean;
  initialUsername: string;
}

export const ChessComModal: React.FC<Props> = ({ onClose, onSync, isProcessing, initialUsername }) => {
  const [username, setUsername] = useState(initialUsername);

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d1117] border border-white/10 rounded-[2.5rem] p-8 w-full max-w-sm shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-black text-white uppercase tracking-wider text-sm flex items-center gap-2">
            <Activity size={16} className="text-emerald-400" /> Chess.com Sync
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <p className="text-slate-400 text-sm mb-6">Fetches your most recent rated game.</p>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && username.trim() && onSync(username.trim())}
          placeholder="Your Chess.com username"
          className="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 mb-6"
          autoFocus
        />
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-2xl font-bold text-sm transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => username.trim() && onSync(username.trim())}
            disabled={!username.trim() || isProcessing}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-2xl font-bold text-sm transition-all"
          >
            {isProcessing ? 'Syncing...' : 'Sync Last Game'}
          </button>
        </div>
      </div>
    </div>
  );
};
