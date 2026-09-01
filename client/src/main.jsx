import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import BuildLiteAuthProvider from './auth/BuildLiteAuthProvider.jsx'

if (import.meta.env.DEV) {
  void import('./cvr/cvrLedgerMigrationDevtools.js').then((module) => {
    module.attachCvrLedgerMigrationDevtools()
  })
  void import('./revenue/revenueSettingsMigrationDevtools.js').then((module) => {
    module.attachRevenueSettingsMigrationDevtools()
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BuildLiteAuthProvider><App /></BuildLiteAuthProvider>
  </StrictMode>,
)
