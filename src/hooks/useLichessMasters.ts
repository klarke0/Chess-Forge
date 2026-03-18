import { useState, useEffect } from 'react';
import { fetchLichessMasters, MastersData } from '../services/api';

export function useLichessMasters(fen: string) {
  const [data, setData] = useState<MastersData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fen) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await fetchLichessMasters(fen);
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fen]);

  return { data, loading };
}
