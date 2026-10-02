import { describe, test, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

/**
 * Deactivate and delete are different things on the Users page: an active
 * person is only ever deactivated; delete is permanent and offered only for
 * inactive or invited accounts, and the server's reason is shown when it
 * keeps an account for the record.
 */

const listUsers = vi.fn()
const deleteUser = vi.fn()
const addToast = vi.fn()

vi.mock("../../services/admin/userService", () => ({
  listUsers: (...a) => listUsers(...a),
  deleteUser: (...a) => deleteUser(...a),
  getUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  setUserRoles: vi.fn(),
  issueTemporaryPassword: vi.fn(),
  resendInvitation: vi.fn(),
}))
vi.mock("../../services/admin/roleService", () => ({ listRoles: vi.fn().mockResolvedValue([]) }))
vi.mock("../../services/admin/branchService", () => ({ listBranches: vi.fn().mockResolvedValue([]) }))
vi.mock("../../components/shared/Toast", () => ({ useToast: () => ({ addToast }) }))
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ hasPermission: () => true, isSystemAdmin: true, user: { userId: 1 } }) }))
vi.mock("./UserDetailDrawer", () => ({ default: () => null }))

const { default: UsersPage } = await import("./UsersPage")

const ROWS = [
  { user_id: 1, first_name: "Ana", last_name: "Active", email: "ana@example.com", status: "active", roles: "Dispatcher" },
  { user_id: 2, first_name: "Ben", last_name: "Inactive", email: "ben@example.com", status: "inactive", roles: "" },
  { user_id: 3, first_name: "Cy", last_name: "Invited", email: "cy@example.com", status: "invited", roles: "" },
]

beforeEach(() => {
  listUsers.mockReset()
  deleteUser.mockReset()
  addToast.mockReset()
  listUsers.mockResolvedValue({ data: ROWS, pagination: { page: 1, limit: 25, total: 3, totalPages: 1 } })
})

// The whole Users page renders for each case, which under a full parallel run
// can pass the default 5 s; a slow pass is still a pass.
describe("Deleting users", { timeout: 15000 }, () => {
  test("an active person can only be deactivated; delete is for inactive and invited accounts", async () => {
    render(<UsersPage />)
    await screen.findByText("ana@example.com")
    expect(screen.getByRole("button", { name: /deactivate ana active/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /delete ana active/i })).toBeNull()
    expect(screen.getByRole("button", { name: /delete ben inactive permanently/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /cancel invitation for cy invited/i })).toBeTruthy()
  })

  test("deleting asks first, then removes the account", async () => {
    deleteUser.mockResolvedValue({ success: true })
    render(<UsersPage />)
    fireEvent.click(await screen.findByRole("button", { name: /delete ben inactive permanently/i }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/can't be undone/i)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: /delete permanently/i }))

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith(2))
    expect(addToast).toHaveBeenCalledWith("User deleted", "success")
  })

  test("an account kept for the record says why", async () => {
    deleteUser.mockRejectedValue(new Error("This user has trips, approvals or other records in Trackify, so the account is kept for the record."))
    render(<UsersPage />)
    fireEvent.click(await screen.findByRole("button", { name: /delete ben inactive permanently/i }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /delete permanently/i }))

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/kept for the record/), "error")
    )
  })
})
