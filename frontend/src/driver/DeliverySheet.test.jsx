import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The real picker opens the camera or gallery; the sheet only needs a file handed to it.
// Opening the camera from the sheet's own button hands a file over too (ref.openCamera()).
vi.mock("./PhotoPick", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  const shot = () => new File(["x"], "waybill.jpg", { type: "image/jpeg" });
  return {
    default: forwardRef(function FakePick({ onFile }, ref) {
      useImperativeHandle(ref, () => ({ openCamera: () => onFile(shot()) }), [onFile]);
      return <button type="button" onClick={() => onFile(shot())}>Take photo</button>;
    }),
  };
});

// The real pad draws on a canvas, which the test browser does not have. This one
// signs with a button, and hands back a PNG blob like the real one.
vi.mock("./SignaturePad", async () => {
  const { forwardRef, useImperativeHandle, useState } = await import("react");
  return {
    default: forwardRef(function FakePad({ onChange }, ref) {
      const [signed, setSigned] = useState(false);
      useImperativeHandle(ref, () => ({
        isEmpty: () => !signed,
        clear: () => { setSigned(false); onChange?.(false); },
        toBlob: () => Promise.resolve(signed ? new Blob(["png"], { type: "image/png" }) : null),
      }), [signed, onChange]);
      return <button type="button" onClick={() => { setSigned(true); onChange?.(true); }}>Sign on pad</button>;
    }),
  };
});

const { default: DeliverySheet } = await import("./DeliverySheet");

const setup = (props = {}) => {
  const onConfirm = vi.fn();
  render(<DeliverySheet tripNo="TT-0032" busy={false} onCancel={() => {}} onConfirm={onConfirm} {...props} />);
  return onConfirm;
};
const proof = () => screen.getByRole("button", { name: "Delivery Proof" });
const confirm = () => screen.getByRole("button", { name: "Confirm Delivery" });

describe("proof of delivery", () => {
  it("asks for the photo first, and will not confirm without it", () => {
    const onConfirm = setup();
    expect(screen.getByText("Tap Delivery Proof to take a photo of the delivery.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Who received it/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm Delivery" })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Delivery Proof opens the camera; with the photo in, it becomes Confirm Delivery", () => {
    const onConfirm = setup();
    expect(proof()).toBeEnabled();
    fireEvent.click(proof());
    // the photo is in: the next step, and nothing filed yet
    expect(screen.getByText("waybill.jpg")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delivery Proof" })).toBeNull();
    expect(confirm()).toBeDisabled();
    expect(screen.getByLabelText(/Who received it/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("asks neutrally for a note, and the photo hint still names the signed waybill", () => {
    setup();
    fireEvent.click(proof());
    expect(screen.getByLabelText(/Note/)).toHaveAttribute("placeholder", "e.g. Left at the receiving bay");
    expect(screen.getByText(/The signed waybill, or the goods/)).toBeInTheDocument();
  });

  it("then asks who received it", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(confirm()).toBeDisabled();
    expect(screen.getByText("Enter who received it.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Who received it/), { target: { value: "   " } });
    expect(confirm()).toBeDisabled(); // spaces are not a name
  });

  it("confirms once there is a photo and a name, sending both", () => {
    const onConfirm = setup();
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    fireEvent.change(screen.getByLabelText(/Who received it/), { target: { value: "  Maria Santos " } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "2 crates short" } });
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const form = onConfirm.mock.calls[0][0];
    expect(form.get("receivedBy")).toBe("Maria Santos");
    expect(form.get("note")).toBe("2 crates short");
    expect(form.get("photo").name).toBe("waybill.jpg");
  });

  it("says the driver has arrived when it opened because the truck reached the pin", () => {
    setup({ arrived: true, place: "Panabo City" });
    expect(screen.getByText("You’ve arrived")).toBeInTheDocument();
    expect(screen.getByText(/Panabo City/)).toBeInTheDocument();
  });

  it("can be cancelled", () => {
    const onCancel = vi.fn();
    setup({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("restores a photo and entered details from the trip draft", () => {
    const photo = new File(["x"], "saved-proof.jpg", { type: "image/jpeg" });
    setup({ draft: { photo, receivedBy: "Maria Santos", note: "Left at receiving" } });
    expect(screen.getByText("saved-proof.jpg")).toBeInTheDocument();
    expect(screen.getByLabelText(/Who received it/)).toHaveDisplayValue("Maria Santos");
    expect(screen.getByLabelText(/Note/)).toHaveDisplayValue("Left at receiving");
    expect(confirm()).toBeEnabled();
  });
});

describe("a delivery that does not go as planned", () => {
  const fill = () => {
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    fireEvent.change(screen.getByLabelText(/Who received it/), { target: { value: "Maria Santos" } });
  };

  it("says when something was wrong with the load, so the problem form follows the delivery", () => {
    const onConfirm = setup();
    fill();
    fireEvent.click(confirm());
    expect(onConfirm.mock.calls[0][1]).toEqual({ withProblem: false });

    cleanup();
    const again = setup();
    fill();
    fireEvent.click(screen.getByLabelText(/Something was wrong with the load/));
    fireEvent.click(confirm());
    expect(again.mock.calls[0][1]).toEqual({ withProblem: true });
  });

  it("offers to report a load that could not be delivered only when the trip allows it", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Couldn.t deliver/ })).toBeNull();

    cleanup();
    const onNotDelivered = vi.fn();
    const onConfirm = setup({ onNotDelivered });
    fireEvent.click(screen.getByRole("button", { name: /Couldn.t deliver\? Report it/ }));
    expect(onNotDelivered).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("the receiver's signature", () => {
  const ready = () => {
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    fireEvent.change(screen.getByLabelText(/Who received it/), { target: { value: "Maria Santos" } });
  };

  it("is offered but not needed when the company does not require it", () => {
    const onConfirm = setup();
    ready();
    expect(screen.getByText(/Receiver.s signature/).textContent).toMatch(/\(optional\)/);
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].get("signature")).toBeNull();
  });

  it("when required, will not confirm without a signature or the reason there is none", () => {
    const onConfirm = setup({ signatureRequired: true });
    ready();
    expect(confirm()).toBeDisabled();
    expect(screen.getByText(/Have the receiver sign/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Receiver did not sign" }));
    expect(confirm()).toBeDisabled();
    expect(screen.getByText("Say why there is no signature.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("sends the drawing as a PNG with the delivery", async () => {
    const onConfirm = setup({ signatureRequired: true });
    ready();
    fireEvent.click(screen.getByRole("button", { name: "Sign on pad" }));
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const form = onConfirm.mock.calls[0][0];
    expect(form.get("signature").type).toBe("image/png");
    expect(form.get("signature").name).toBe("signature.png");
    expect(form.get("unsignedReason")).toBeNull();
  });

  it("a double tap while the drawing is being prepared files the delivery once", async () => {
    let finish;
    const onConfirm = vi.fn(() => new Promise((r) => { finish = r; }));
    render(<DeliverySheet tripNo="TT-0032" busy={false} onCancel={() => {}} onConfirm={onConfirm} />);
    ready();
    fireEvent.click(screen.getByRole("button", { name: "Sign on pad" }));
    fireEvent.click(confirm());
    fireEvent.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    fireEvent.click(confirm()); // still filing
    await new Promise((r) => setTimeout(r, 20));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // once it has been answered (say it failed), the driver can try again
    finish();
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(confirm());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });

  it("sends the reason when the receiver did not sign, and no drawing", () => {
    const onConfirm = setup({ signatureRequired: true });
    ready();
    fireEvent.click(screen.getByRole("button", { name: "Receiver did not sign" }));
    fireEvent.click(screen.getByRole("radio", { name: "Refused to sign" }));
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());
    const form = onConfirm.mock.calls[0][0];
    expect(form.get("unsignedReason")).toBe("refused");
    expect(form.get("signature")).toBeNull();
  });

  it("can go back to signing, which drops the reason", () => {
    setup({ signatureRequired: true });
    ready();
    fireEvent.click(screen.getByRole("button", { name: "Receiver did not sign" }));
    fireEvent.click(screen.getByRole("radio", { name: "Unable to sign" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign instead" }));
    expect(screen.getByRole("button", { name: "Sign on pad" })).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
  });

  it("Clear starts the signature over", () => {
    setup({ signatureRequired: true });
    ready();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sign on pad" }));
    expect(confirm()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(confirm()).toBeDisabled();
  });
});
