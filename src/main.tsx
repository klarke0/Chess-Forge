import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

const AppV2 = lazy(() => import('./v2/AppV2.tsx'));

const useV2 = new URLSearchParams(window.location.search).get('v2') === 'true';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {useV2 ? (
      <Suspense fallback={<div className="h-screen bg-[#050507]" />}>
        <AppV2 />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
