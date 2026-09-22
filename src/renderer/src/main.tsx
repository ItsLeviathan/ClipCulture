import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import type { ReelForgeApi } from '@shared/types'

declare global {
  interface Window {
    reelforge: ReelForgeApi
  }
}

createRoot(document.getElementById('root')!).render(<App />)
