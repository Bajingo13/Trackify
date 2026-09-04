import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../../config/db.js";
import { loadAuthProfile } from "./auth.service.js";

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const [rows] = await db.execute(
      "SELECT user_id, email, password_hash, first_name, last_name, status FROM users WHERE email = ?",
      [email]
    );

    const user = rows[0];
    // Constant-ish: always run a compare so timing doesn't leak account existence.
    const hash = user?.password_hash || "$2b$10$0000000000000000000000000000000000000000000000000000";
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    if (user.status !== "active") {
      return res.status(403).json({ success: false, message: "Account is inactive." });
    }

    const profile = await loadAuthProfile(user.user_id);

    // A role built entirely from driverapp.* permissions (e.g. "Driver") has
    // nothing to do on the staff web console — every page would come up
    // empty. Point them at the driver app instead of issuing a staff token.
    const isDriverAppOnly =
      profile.permissions.length > 0 &&
      profile.permissions.every((p) => p.startsWith("driverapp."));
    if (isDriverAppOnly) {
      return res.status(403).json({
        success: false,
        code: "DRIVER_APP_ONLY",
        message: "This account only has Driver App access. Sign in at /driver with your employee number and PIN instead.",
      });
    }

    const token = signToken({ userId: user.user_id, email: user.email });

    res.json({
      success: true,
      message: "Login successful.",
      data: {
        token,
        user: {
          userId: profile.user.userId,
          email: profile.user.email,
          firstName: profile.user.firstName,
          lastName: profile.user.lastName,
        },
        access: profile.access,
        roles: profile.roles,
        permissions: profile.permissions,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function register(req, res, next) {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ success: false, message: "All fields are required." });
    }

    const [existing] = await db.execute("SELECT user_id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: "Email already registered." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await db.execute(
      "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, ?, ?, ?, 'active')",
      [email, passwordHash, firstName, lastName]
    );

    // A freshly self-registered user has no roles yet — no permissions, no access.
    const token = signToken({ userId: result.insertId, email });

    res.status(201).json({
      success: true,
      message: "Registration successful.",
      data: {
        token,
        user: { userId: result.insertId, email, firstName, lastName },
        access: [],
        roles: [],
        permissions: [],
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/me
 * Optional X-Company-Id / X-Branch-Id headers scope the returned permissions to
 * that operating context; otherwise the user's first access entry is used.
 */
export async function getMe(req, res, next) {
  try {
    const companyId = Number(req.headers["x-company-id"]) || null;
    const branchId = Number(req.headers["x-branch-id"]) || null;

    const profile = await loadAuthProfile(req.user.userId, { companyId, branchId });
    if (!profile) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({
      success: true,
      data: {
        user: profile.user,
        access: profile.access,
        roles: profile.roles,
        permissions: profile.permissions,
        scope: profile.scope,
      },
    });
  } catch (error) {
    next(error);
  }
}
