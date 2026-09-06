import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme/fonts.css'
import './index.css'
import './theme/tokens.css'
import './theme/legacy-bridge.css'
import './theme/system.css'
import { initTheme } from './theme/theme'

initTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
