import React, { useEffect, useState } from "react";
import { BottomNav, V2Tab } from "./BottomNav";
import { HomeScreen, type TrainingMode, type PhaseFilter } from "./HomeScreen";
import { TrainNowScreen } from "./TrainNowScreen";
import { GamesTab } from "@/components/GamesTab";
import { InsightsTab } from "@/components/InsightsTab";
import { useRepertoireStore } from "@/stores/repertoireStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useEngineStore } from "@/stores/engineStore";
import { BackgroundAnalysisQueue } from "@/services/background_analysis";

const AppV2: React.FC = () => {
  const [activeTab, setActiveTab] = useState<V2Tab>("train");
  const [drilling, setDrilling] = useState(false);
  const [analyzingGame, setAnalyzingGame] = useState(false);
  const [deviationFen, setDeviationFen] = useState<string | null>(null);
  const [trainingMode, setTrainingMode] = useState<TrainingMode>("blunder");
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const appTheme = useSettingsStore((s) => s.appearance.theme);
  const initEngine = useEngineStore((s) => s.initEngine);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", appTheme);
  }, [appTheme]);

  useEffect(() => {
    useRepertoireStore.getState().loadFromApi();
    initEngine();
    BackgroundAnalysisQueue.start();
  }, []);

  function handleTrainNow(mode: TrainingMode, phase: PhaseFilter) {
    setTrainingMode(mode);
    setPhaseFilter(phase);
    setDrilling(true);
  }

  function handleBackFromDrill() {
    setDrilling(false);
    setDeviationFen(null);
  }

  function handleNavigateToGames() {
    setActiveTab("games");
  }

  return (
    <div className="flex items-start justify-center h-[100dvh] bg-[#020204] text-slate-200 font-outfit overflow-hidden">
      {/* Phone-width container — centered on desktop, full-width on mobile */}
      <div className="relative flex flex-col h-[100dvh] w-full max-w-[430px] bg-[var(--bg-base)] overflow-hidden shadow-2xl shadow-black/60">
        {/* Main content */}
        <div
          className={`flex-1 min-h-0 flex flex-col overflow-hidden ${drilling || analyzingGame ? "" : "mb-16"}`}
        >
          {drilling ? (
            <TrainNowScreen
              onBack={handleBackFromDrill}
              singlePositionFen={deviationFen ?? undefined}
              mode={trainingMode}
              phase={phaseFilter}
            />
          ) : (
            <>
              {activeTab === "train" && (
                <HomeScreen
                  onTrainNow={handleTrainNow}
                  onGames={handleNavigateToGames}
                />
              )}

              {activeTab === "games" && (
                <GamesTab
                  onDrillDeviation={(fen) => {
                    setDeviationFen(fen);
                    setDrilling(true);
                  }}
                  onAnalysisOpen={() => setAnalyzingGame(true)}
                  onAnalysisClose={() => setAnalyzingGame(false)}
                />
              )}

              {activeTab === "insights" && <InsightsTab />}
            </>
          )}
        </div>

        {/* Bottom nav — hide during drilling or game analysis */}
        {!drilling && !analyzingGame && (
          <BottomNav activeTab={activeTab} onNavigate={setActiveTab} />
        )}
      </div>
    </div>
  );
};

export default AppV2;
