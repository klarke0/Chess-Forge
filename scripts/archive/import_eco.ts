import { Chess } from 'chess.js';

const API_URL = 'http://localhost:3001/api/repertoires/import';
const LETTERS = ['a', 'b', 'c', 'd', 'e'];

async function importEco() {
  console.log("Downloading ECO TSVs from Lichess...");
  const gamesByBaseName: Record<string, any[]> = {};

  const ECO_GROUPS: Record<string, string> = {
    'a': 'Vol A: Flank Openings',
    'b': 'Vol B: Semi-Open (non-French)',
    'c': 'Vol C: Open Games & French',
    'd': 'Vol D: Closed & Semi-Closed',
    'e': 'Vol E: Indian Defenses'
  };

  for (const letter of LETTERS) {
    const res = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${letter}.tsv`);
    const text = await res.text();
    // Safely split lines
    const lines = text.split(/\r?\n/).slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      // split by tabs
      const [eco, name, pgn] = line.split(/\t/);
      if (!pgn) continue;
      const baseName = name.split(':')[0].split(',')[0].trim();
      
      const groupPrefix = ECO_GROUPS[letter];
      const fullName = `${groupPrefix}: ${baseName}`;
      
      if (!gamesByBaseName[fullName]) {
        gamesByBaseName[fullName] = [];
      }
      
      gamesByBaseName[fullName].push({
        eco,
        name,
        pgn
      });
    }
  }

  console.log(`Found ${Object.keys(gamesByBaseName).length} base openings.`);

  const positions: Record<string, any[]> = {};
  const chapters = [];

  for (const [baseName, variations] of Object.entries(gamesByBaseName)) {
    variations.sort((a, b) => a.pgn.length - b.pgn.length);
    const baseVariation = variations[0];
    
    const chess = new Chess();
    const startMoves: string[] = [];
    try {
      const tokens = baseVariation.pgn.split(/\s+/).filter((t: string) => !/^\d+\./.test(t) && t.length > 0);
      for (const token of tokens) {
        const m = chess.move(token);
        if (m) startMoves.push(m.san);
      }
    } catch(e) {}
    
    chapters.push({
      name: baseName,
      startMoves,
      firstFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    });
    
    for (const v of variations) {
      const g = new Chess();
      const tokens = v.pgn.split(/\s+/).filter((t: string) => !/^\d+\./.test(t) && t.length > 0);
      
      for (const token of tokens) {
        const fenBefore = g.fen().split(' ').slice(0, 4).join(' ');
        let m;
        try { m = g.move(token); } catch(e) { break; }
        if (!m) break;
        
        const san = m.san;
        const nextFen = g.fen().split(' ').slice(0, 4).join(' ');
        
        if (!positions[fenBefore]) positions[fenBefore] = [];
        const existing = positions[fenBefore].find((x: any) => x.san === san);
        
        const comment = `ECO: ${v.eco} - ${v.name}`;
        
        if (!existing) {
          positions[fenBefore].push({ san, nextFen, comment });
        } else {
          if (!existing.comment) {
            existing.comment = comment;
          }
        }
      }
    }
  }

  console.log(`Uploading ${Object.keys(positions).length} unique positions to backend...`);
  
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: "Encyclopedia of Chess Openings (ECO)",
      chapters,
      positions,
      side: 'white' 
    })
  });

  if (response.ok) {
    const result = await response.json();
    console.log("Success! Imported ECO Repertoire:", result);
  } else {
    const err = await response.text();
    console.error("Failed to import:", err);
  }
}

importEco();