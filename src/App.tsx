import React, { useEffect, useState } from 'react';
import { Layout, TabMode } from './components/Layout';
import { Header } from './components/Header';
import { TrainTab } from './components/TrainTab';
import { GamesTab } from './components/GamesTab';
import { LibraryTab } from './components/LibraryTab';
import { ReviewTab } from './components/ReviewTab';
import { InsightsTab } from './components/InsightsTab';
import { MistakeReplay } from './components/MistakeReplay';
import { useTraining } from './hooks/useTraining';
import { useEngineStore } from './stores/engineStore';
import { useRepertoireStore } from './stores/repertoireStore';
import { useTrainingStore } from './stores/trainingStore';
import { useSettingsStore } from './stores/settingsStore';
import { BackgroundAnalysisQueue } from './services/background_analysis';
import * as api from './services/api';
import { SettingsPanel } from './components/SettingsPanel';

const App: React.FC = () => {
  const {
    getFen, onDrop, handleNext, startTraining,
    playDemo, handleDeepAnalysis, jumpToMove,
    showSolution, giveUp, resetGame, restartChapter,
    stepBackward, jumpToPosition,
    playRepertoireMove, playMainline, demoEngineLine,
    previewEngineLine, stopPreview,
  } = useTraining();

  const initEngine = useEngineStore(s => s.initEngine);
  const repertoireId = useRepertoireStore(s => s.repertoireId);
  const appTheme = useSettingsStore(s => s.appearance.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', appTheme);
  }, [appTheme]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabMode>('train');
  const [dueBadge, setDueBadge] = useState(0);
  const [openGameId, setOpenGameId] = useState<number | null>(null);
  const [openMoveIdx, setOpenMoveIdx] = useState<number | null>(null);

  useEffect(() => {
    initEngine();
    BackgroundAnalysisQueue.start();
  }, [initEngine]);

  useEffect(() => {
    useRepertoireStore.getState().loadFromApi();
  }, []);

  useEffect(() => {
    if (!repertoireId) return;
    api.getDuePositions(repertoireId)
      .then(positions => setDueBadge(positions.length))
      .catch(() => {});
  }, [repertoireId]);

  const handleSelectChapter = (idx: number) => {
    requestAnimationFrame(() => {
      try {
        // 1. Switch tab
        setActiveTab('train');
        
        // 2. Update state
        const rs = useRepertoireStore.getState();
        const ts = useTrainingStore.getState();
        
        ts.setMode('study');
        rs.selectChapter(idx);
        
        // 3. Start training logic
        startTraining(idx);
      } catch (err) {
        console.error('[App] handleSelectChapter CRASH:', err);
      }
    });
  };

  const handleViewGameFromInsight = (gameId: number, moveIdx?: number) => {
    setOpenGameId(gameId);
    if (moveIdx !== undefined) setOpenMoveIdx(moveIdx);
    setActiveTab('games');
    // Reset after one render so the effect can fire again if user navigates to same game
    setTimeout(() => {
      setOpenGameId(null);
      setOpenMoveIdx(null);
    }, 100);
  };

  return (
    <>
    <Layout activeMode={activeTab} onNavigate={setActiveTab} dueBadge={dueBadge}>
      <Header
        onReset={resetGame}
        activeTab={activeTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      
      <div className="flex-1 relative min-h-0">
        {activeTab === 'train' && (
          <TrainTab
            fen={getFen()}
            onDrop={onDrop}
            onProceed={handleNext}
            onBack={stepBackward}
            onReset={restartChapter}
            onStartTraining={startTraining}
            onDeepAnalysis={handleDeepAnalysis}
            onPlayDemo={playDemo}
            onShowSolution={showSolution}
            onGiveUp={giveUp}
            onJumpToMove={jumpToMove}
            onPlayRepertoireMove={playRepertoireMove}
            onPlayMainline={playMainline}
            onDemoEngineLine={demoEngineLine}
            onHighlightEngineLine={previewEngineLine}
            onStopHighlight={stopPreview}
          />
        )}

        {activeTab === 'games' && (
          <GamesTab
            onDrillDeviation={(fen) => {
              jumpToPosition(fen);
              setActiveTab('train');
            }}
            initialGameId={openGameId}
            initialMoveIdx={openMoveIdx}
          />
        )}

        {activeTab === 'library' && (
          <LibraryTab onSelectChapter={handleSelectChapter} />
        )}

        {activeTab === 'film' && (
          <MistakeReplay
            onViewGame={handleViewGameFromInsight}
            onClose={() => setActiveTab('insights')}
          />
        )}

        {activeTab === 'review' && (
          <ReviewTab onClose={() => setActiveTab('train')} />
        )}

        {activeTab === 'insights' && (
          <InsightsTab />
        )}
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </Layout>
    <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
};

export default App;
