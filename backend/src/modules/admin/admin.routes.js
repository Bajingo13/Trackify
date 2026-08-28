import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as companies from "./companies.controller.js";
import * as branches from "./branches.controller.js";
import * as users from "./users.controller.js";
import * as roles from "./roles.controller.js";
import * as audit from "./audit.controller.js";

const router = express.Router();

/* Companies */
router.get("/companies", requirePermission("company.read"), asyncHandler(companies.listCompanies));
router.get("/companies/:id", requirePermission("company.read"), asyncHandler(companies.getCompany));
router.post("/companies", requirePermission("company.manage"), asyncHandler(companies.createCompany));
router.patch("/companies/:id", requirePermission("company.manage"), asyncHandler(companies.updateCompany));

/* Branches */
router.get("/branches", requirePermission("branch.read"), asyncHandler(branches.listBranches));
router.get("/branches/:id", requirePermission("branch.read"), asyncHandler(branches.getBranch));
router.post("/branches", requirePermission("branch.manage"), asyncHandler(branches.createBranch));
router.patch("/branches/:id", requirePermission("branch.manage"), asyncHandler(branches.updateBranch));

/* Users */
router.get("/users", requirePermission("user.read"), asyncHandler(users.listUsers));
router.get("/users/:id", requirePermission("user.read"), asyncHandler(users.getUser));
router.post("/users", requirePermission("user.manage"), asyncHandler(users.createUser));
router.patch("/users/:id", requirePermission("user.manage"), asyncHandler(users.updateUser));
router.put("/users/:id/roles", requirePermission("user.manage"), asyncHandler(users.setUserRoles));

/* Roles & permissions */
router.get("/permissions", requirePermission("role.read"), asyncHandler(roles.listPermissions));
router.get("/roles", requirePermission("role.read"), asyncHandler(roles.listRoles));
router.get("/roles/:id", requirePermission("role.read"), asyncHandler(roles.getRole));
router.post("/roles", requirePermission("role.manage"), asyncHandler(roles.createRole));
router.patch("/roles/:id", requirePermission("role.manage"), asyncHandler(roles.updateRole));
router.put("/roles/:id/permissions", requirePermission("role.manage"), asyncHandler(roles.setRolePermissions));

/* Audit log */
router.get("/audit-logs", requirePermission("audit.read"), asyncHandler(audit.listAuditLogs));

export default router;
