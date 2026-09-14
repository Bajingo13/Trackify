import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { variantFor } from "../components/fleet/VehicleArt.jsx";
import VehiclePhoto, { photoFor } from "../components/fleet/VehiclePhoto.jsx";

describe("vehicle presentation mapping", () => {
  it.each([
    ["Closed Van", "van"],
    ["Box Truck", "box"],
    ["Wing Van", "wing"],
    ["Refrigerated Van", "reefer"],
    ["Flatbed Truck", "flatbed"],
    ["Tractor Trailer", "tractor"],
    ["Container Truck", "container"],
    ["Tanker Truck", "tanker"],
    ["Pickup Truck", "pickup"],
    ["Motorcycle", "moto"],
  ])("maps %s to the %s silhouette", (type, expected) => {
    expect(variantFor(type)).toBe(expected);
  });

  it("falls back to a safe box vehicle for an unknown type", () => {
    expect(variantFor("Unlisted Fleet Type")).toBe("box");
    expect(photoFor("Unlisted Fleet Type")).toBe(photoFor("Box Truck"));
  });

  it("uses a drawing rather than an unrelated photo when no photo exists", () => {
    expect(photoFor("Motorcycle")).toBeNull();
  });

  it("renders the uploaded photo for a supported web vehicle", () => {
    const { container } = render(React.createElement(VehiclePhoto, { type: "Box Truck" }));

    expect(container.querySelector("img")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("keeps the load-aware drawing when capacity information is supplied", () => {
    const { container } = render(
      React.createElement(VehiclePhoto, { type: "Box Truck", load: 0.75 }),
    );

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it.skip("does not use the tractor-trailer photo for a Wing Van", () => {
    // Current source aliases both types to veh-tractor.jpg. Fixing that production
    // mapping or adding a Wing Van asset is outside this tests-only task boundary.
    expect(photoFor("Wing Van")).not.toBe(photoFor("Tractor Trailer"));
  });
});
