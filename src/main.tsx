import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AppProviders } from './app/AppProviders'
import './styles/tokens.css'
import './styles/global.css'
import './styles/workstation.css'

const root = document.getElementById('root')
if (!root) throw new Error('Application root was not found.')

createRoot(root).render(
  <StrictMode>
    <AppProviders><App /></AppProviders>
  </StrictMode>,
)
