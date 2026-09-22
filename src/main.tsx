import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const AppV2 = lazy(() => import("./v2/AppV2.tsx"));
const StyleGuideScreen = lazy(() =>
  import("./v2/StyleGuideScreen.tsx").then((m) => ({ default: m.StyleGuideScreen })),
);

const params = new URLSearchParams(window.location.search);
const useV2 = params.get("v1") !== "true";
const useStyleGuide = params.get("styleguide") === "true";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="h-screen bg-[#050507]" />}>
      {useStyleGuide ? <StyleGuideScreen /> : useV2 ? <AppV2 /> : <App />}
    </Suspense>
  </React.StrictMode>,
);
