import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import SignaturePad from "./SignaturePad";

describe("the signature pad itself", () => {
  it("is a labelled drawing area that does not scroll the page while signing", () => {
    render(<SignaturePad label="Receiver's signature" />);
    const pad = screen.getByRole("img", { name: "Receiver's signature" });
    expect(pad.tagName).toBe("CANVAS");
    expect(pad.style.touchAction).toBe("none");
  });

  it("starts empty, and gives no drawing until something is signed", async () => {
    const ref = createRef();
    const onChange = vi.fn();
    render(<SignaturePad ref={ref} onChange={onChange} />);
    expect(ref.current.isEmpty()).toBe(true);
    await expect(ref.current.toBlob()).resolves.toBeNull();
  });
});
