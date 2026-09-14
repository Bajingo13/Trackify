import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../context/AuthContext.jsx";
import { usePermissions } from "./permissions.jsx";

function PermissionProbe() {
  const { can, canAny } = usePermissions();
  return (
    <div
      data-testid="permissions"
      data-create={String(can("trip.create"))}
      data-approve={String(can("trip.approve"))}
      data-any={String(canAny(["trip.approve", "finance.view"]))}
    />
  );
}

function renderPermissions(permissions) {
  localStorage.setItem("ttms_auth", JSON.stringify({ permissions }));
  render(
    <AuthProvider>
      <PermissionProbe />
    </AuthProvider>,
  );
  return screen.getByTestId("permissions");
}

describe("permission facade", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("allows exact permissions and rejects permissions the user lacks", () => {
    const result = renderPermissions(["trip.create", "finance.view"]);

    expect(result).toHaveAttribute("data-create", "true");
    expect(result).toHaveAttribute("data-approve", "false");
    expect(result).toHaveAttribute("data-any", "true");
  });

  it("treats system.admin as a wildcard for can and canAny", () => {
    const result = renderPermissions(["system.admin"]);

    expect(result).toHaveAttribute("data-create", "true");
    expect(result).toHaveAttribute("data-approve", "true");
    expect(result).toHaveAttribute("data-any", "true");
  });
});
