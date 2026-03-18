export interface ChessComGame {
  url: string;
  pgn: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
  end_time: number;
  time_control: string;
  uuid: string;
}

export async function getLastGame(username: string): Promise<ChessComGame | null> {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    
    // 1. Get current month's games
    const response = await fetch(`https://api.chess.com/pub/player/${username}/games/${year}/${month}`);
    if (!response.ok) throw new Error('Failed to fetch from Chess.com');
    
    const data = await response.json();
    if (!data.games || data.games.length === 0) {
      // Try previous month if current month is empty
      const prev = new Date();
      prev.setMonth(prev.getMonth() - 1);
      const py = prev.getFullYear();
      const pm = String(prev.getMonth() + 1).padStart(2, '0');
      const prevResponse = await fetch(`https://api.chess.com/pub/player/${username}/games/${py}/${pm}`);
      if (!prevResponse.ok) return null;
      const prevData = await prevResponse.json();
      if (!prevData.games || prevData.games.length === 0) return null;
      return prevData.games[prevData.games.length - 1];
    }
    
    return data.games[data.games.length - 1];
  } catch (error) {
    console.error('Chess.com API Error:', error);
    return null;
  }
}

export async function getGames(username: string, limit = 10): Promise<ChessComGame[]> {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const response = await fetch(`https://api.chess.com/pub/player/${username}/games/${year}/${month}`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.games || []).slice(-limit).reverse();
  } catch {
    return [];
  }
}
