import React from 'react';
import { ControlMap } from '../utils/chessLogic';
import { Square } from 'chess.js';

interface VisionOverlayProps {
  control: ControlMap;
  orientation: 'white' | 'black';
  playerColor?: 'white' | 'black';
}

export const VisionOverlay: React.FC<VisionOverlayProps> = ({ control, orientation, playerColor = 'white' }) => {
  const squares: Square[] = [
    'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
    'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
    'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
    'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
    'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
    'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
    'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
    'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1',
  ];

  const displaySquares = orientation === 'white' ? squares : [...squares].reverse();

  return (
    <div className="absolute inset-0 z-10 grid grid-cols-8 grid-rows-8 pointer-events-none">
      {displaySquares.map((sq) => {
        const val = control[sq];
        let bg = 'transparent';
        
        if (val === 0) return <div key={sq} className="w-full h-full" />;

        const isWhiteControl = val > 0;
        const isPlayerControl = (playerColor === 'white' && isWhiteControl) || (playerColor === 'black' && !isWhiteControl);
        const strength = Math.abs(val);
        const opacity = Math.min(0.6, strength * 0.15);

        if (isPlayerControl) {
           bg = `rgba(34, 197, 94, ${opacity})`; // Green-500
        } else {
           bg = `rgba(244, 63, 94, ${opacity})`; // Rose-500
        }

        return (
          <div key={sq} className="w-full h-full" style={{ backgroundColor: bg }} />
        );
      })}
    </div>
  );
};
