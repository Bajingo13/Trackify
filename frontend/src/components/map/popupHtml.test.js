import { describe, expect, it } from "vitest";
import { escapePopupHtml, popupText } from "./popupHtml";

describe("map popup HTML", () => {
  it("renders editable labels as text rather than executable markup", () => {
    const unsafe = `<img src=x onerror="alert('route')"> & Depot`;
    const escaped = escapePopupHtml(unsafe);

    expect(escaped).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;route&#39;)&quot;&gt; &amp; Depot",
    );
    expect(popupText(unsafe)).not.toContain("<img");
  });

  it("handles missing values without putting undefined into a popup", () => {
    expect(popupText(null)).toBe("<span></span>");
  });
});
