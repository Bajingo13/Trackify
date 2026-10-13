import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The real picker opens the camera or gallery; the sheet only needs a file handed to it.
vi.mock("./PhotoPick", () => ({
  default: ({ onFile }) => (
    <button type="button" onClick={() => onFile(new File(["x"], "waybill.jpg", { type: "image/jpeg" }))}>Take photo</button>
  ),
}));

const { default: DeliverySheet } = await import("./DeliverySheet");

const setup = (props = {}) => {
  const onConfirm = vi.fn();
  render(<DeliverySheet tripNo="TT-0032" busy={false} onCancel={() => {}} onConfirm={onConfirm} {...props} />);
  return onConfirm;
};
const confirm = () => screen.getByRole("button", { name: "Confirm delivery" });

describe("proof of delivery", () => {
  it("asks for the photo first, and will not confirm without it", () => {
    setup();
    expect(confirm()).toBeDisabled();
    expect(screen.getByText("Take a photo of the delivery first.")).toBeInTheDocument();

    // a name alone is not proof
    fireEvent.change(screen.getByLabelText(/Who received it/), { target: { value: "Maria Santos" } });
    expect(confirm()).toBeDisabled();
    expect(screen.getByText("Take a photo of the delivery first.")).toBeInTheDocument();
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
});
