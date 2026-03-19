import React, { useEffect, useState } from 'react';
import { BottomNav, V2Tab } from './BottomNav';
import { HomeScreen } from './HomeScreen';
import { TrainNowScreen } from './TrainNowScreen';
import { GamesTab } from '@/components/GamesTab';
import { InsightsTab } from '@/components/InsightsTab';
import { useRepertoireStore } from '@/stores/repertoireStore';
import { useSettingsStore } from '@/stores/settingsStore';

const AppV2: React.FC = () => {
  const [activeTab, setActiveTab] = useState<V2Tab>('train');
  const [drilling, setDrilling] = useState(false);
  const appTheme = useSettingsStore(s => s.appearance.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', appTheme);
  }, [appTheme]);

  useEffect(() => {
    useRepertoireStore.getState().loadFromApi();
  }, []);

  function handleTrainNow() {
    setDrilling(true);
  }

  function handleBackFromDrill() {
    setDrilling(false);
  }

  function handleNavigateToGames() {
    setActiveTab('games');
  }

  return (
    <div className="flex items-start justify-center h-screen bg-[#020204] text-slate-200 font-outfit overflow-hidden">
      {/* Phone-width container — centered on desktop, full-width on mobile */}
      <div className="relative flex flex-col h-screen w-full max-w-[430px] bg-[var(--bg-base)] overflow-hidden shadow-2xl shadow-black/60">
      {/* Main content */}
      <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${drilling ? '' : 'mb-16'}`}>
        {drilling ? (
          <TrainNowScreen onBack={handleBackFromDrill} />
        ) : (
          <>
            {activeTab === 'train' && (
              <HomeScreen
                onTrainNow={handleTrainNow}
                onGames={handleNavigateToGames}
              />
            )}

            {activeTab === 'games' && (
              <GamesTab onDrillDeviation={() => {}} />
            )}

            {activeTab === 'insights' && (
              <InsightsTab />
            )}
          </>
        )}
      </div>

      {/* Bottom nav — hide during active drilling */}
      {!drilling && (
        <BottomNav activeTab={activeTab} onNavigate={setActiveTab} />
      )}
      </div>
    </div>
  );
};

export default AppV2;
