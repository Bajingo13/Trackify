/**
 * Entry point for the driver app built on its own.
 *
 * The website's entry (main.jsx) mounts the whole back office and reaches the
 * driver screens at /driver. This one mounts nothing but the driver app, and is
 * what Capacitor wraps into the Android/iOS build — so the app a driver
 * installs does not carry the dispatch board, the map library or the
 * spreadsheet exporter it will never open.
 *
 * Same components, same source files. Only the shell differs.
 */
import React from "react"
import ReactDOM from "react-dom/client"
import DriverApp from "./driver/DriverApp"
import "./theme/fonts.css"
import "./index.css"
import "./theme/tokens.css"
import "./theme/legacy-bridge.css"
import "./theme/system.css"
import { initTheme } from "./theme/theme"

initTheme()

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DriverApp />
  </React.StrictMode>,
)
