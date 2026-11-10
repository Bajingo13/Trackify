import trackifyLogoLight from "../../assets/brand/trackify-logo-on-light.svg";
import trackifyLogoDark from "../../assets/brand/trackify-logo-on-dark.svg";
import trackifyMarkLight from "../../assets/brand/trackify-mark-on-light.svg";
import trackifyMarkDark from "../../assets/brand/trackify-mark-on-dark.svg";
import "./trackify-brand.css";

/** Theme-aware Trackify branding with genuinely transparent SVG artwork. */
export default function TrackifyBrand({ compact = false, className = "" }) {
  const light = compact ? trackifyMarkLight : trackifyLogoLight;
  const dark = compact ? trackifyMarkDark : trackifyLogoDark;

  return (
    <span
      className={`tk-brand ${compact ? "tk-brand--mark" : "tk-brand--wordmark"} ${className}`.trim()}
      role="img"
      aria-label="Trackify"
    >
      <img className="tk-brand__image tk-brand__image--light" src={light} alt="" aria-hidden="true" draggable="false" />
      <img className="tk-brand__image tk-brand__image--dark" src={dark} alt="" aria-hidden="true" draggable="false" />
    </span>
  );
}
