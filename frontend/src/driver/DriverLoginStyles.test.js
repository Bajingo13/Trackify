import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "src/driver/driver.css"), "utf8");

const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "gm"))]
    .map((match) => match[1])
    .join("\n");
};

describe("driver sign-in visual system", () => {
  it("uses borderless touch-sized fields with a visible keyboard focus state", () => {
    expect(rule(".dr-loginfield")).toMatch(/min-height:\s*52px/);
    expect(rule(".dr-loginfield")).toMatch(/border:\s*0/);
    expect(rule(".dr-loginfield")).toMatch(/border-radius:\s*var\(--dr-r-pill\)/);
    expect(rule(".dr-loginfield:focus-within")).toMatch(/0 0 0 3px/);
  });

  it("keeps the sheet and primary action borderless without losing hierarchy", () => {
    expect(rule(".dr-shot-sheet")).toMatch(/border:\s*0/);
    expect(rule(".dr-shot-sheet")).toMatch(/background:\s*transparent/);
    expect(rule(".dr-shot-sheet")).toMatch(/border-radius:\s*0/);
    expect(rule(".dr-login .dr-grab")).toMatch(/display:\s*none/);
    expect(rule(".dr-btn.ink.dr-login-go")).toMatch(/min-height:\s*52px/);
    expect(rule(".dr-btn.ink.dr-login-go")).toMatch(/border:\s*0/);
    expect(rule(".dr-btn.ink.dr-login-go:disabled")).toMatch(/opacity:\s*1/);
  });

  it("uses a compact responsive form and moves it down only when height allows", () => {
    expect(rule(".dr-shot-sheet")).toMatch(/max-width:\s*420px/);
    expect(rule(".dr-login .dr-shot-sheet")).toMatch(/margin-top:\s*clamp\(0px, calc\(\(100dvh - 680px\) \* \.1\), 26px\)/);
    expect(rule(".dr-login .dr-shot-sheet")).toMatch(/padding:\s*20px var\(--dr-6\) 24px/);
    expect(rule(".dr-login-field-group")).toMatch(/margin-bottom:\s*12px/);
  });

  it("uses one continuous system surface in both themes", () => {
    expect(rule(".dr-login.shot")).toMatch(/background:\s*var\(--dr-bg\)/);
    expect(rule(':root[data-theme="dark"] .dr-login .dr-shot-sheet')).toMatch(/background:\s*transparent/);
  });

  it("keeps the small AstreaBlue header at the top-left in both themes", () => {
    expect(rule(".dr-hero-mark")).toMatch(/position:\s*absolute/);
    expect(rule(".dr-hero-mark")).toMatch(/top:\s*var\(--dr-4\)/);
    expect(rule(".dr-hero-mark")).toMatch(/left:\s*var\(--dr-4\)/);
    expect(rule(".dr-hero-mark")).toMatch(/justify-content:\s*flex-start/);
    expect(rule(".dr-wordmark-box")).toMatch(/width:\s*112px/);
    expect(rule(".dr-wordmark-box")).toMatch(/height:\s*38px/);
    expect(rule(".dr-wordmark-light")).toMatch(/height:\s*67px/);
    expect(rule(".dr-wordmark-dark")).toMatch(/height:\s*38px/);
  });

  it("keeps browser autofill and text selection inside the field palette", () => {
    expect(css).toMatch(/input:-webkit-autofill[\s\S]*-webkit-box-shadow:\s*0 0 0 1000px var\(--dr-card\) inset !important/);
    expect(css).toMatch(/data-theme="dark"[\s\S]*input:-webkit-autofill[\s\S]*var\(--dr-card-2\) inset !important/);
    expect(rule(".dr-loginfield input::selection")).toMatch(/rgba\(36, 85, 214, \.18\)/);
    expect(rule(".dr-loginfield:focus-within")).not.toMatch(/transform/);
  });
});
