import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../config/db.js";

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

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const user = rows[0];

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Account is inactive.",
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const [accessRows] = await db.execute(
      `SELECT uca.company_id, uca.branch_id, c.trade_name AS company_name, b.branch_name
       FROM user_company_access uca
       JOIN companies c ON c.company_id = uca.company_id
       LEFT JOIN branches b ON b.branch_id = uca.branch_id
       WHERE uca.user_id = ? AND uca.status = 'active'`,
      [user.user_id]
    );

    const [roleRows] = await db.execute(
      `SELECT ur.role_id, r.role_name, ur.company_id, ur.branch_id
       FROM user_roles ur
       JOIN roles r ON r.role_id = ur.role_id
       WHERE ur.user_id = ? AND ur.status = 'active'`,
      [user.user_id]
    );

    const token = jwt.sign(
      { userId: user.user_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    res.json({
      success: true,
      message: "Login successful.",
      data: {
        token,
        user: {
          userId: user.user_id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
        },
        access: accessRows,
        roles: roleRows,
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
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
      });
    }

    const [existing] = await db.execute(
      "SELECT user_id FROM users WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email already registered.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await db.execute(
      "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, ?, ?, ?, 'active')",
      [email, passwordHash, firstName, lastName]
    );

    const token = jwt.sign(
      { userId: result.insertId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    res.status(201).json({
      success: true,
      message: "Registration successful.",
      data: {
        token,
        user: {
          userId: result.insertId,
          email,
          firstName,
          lastName,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getMe(req, res, next) {
  try {
    const [rows] = await db.execute(
      "SELECT user_id, email, first_name, last_name, status, created_at FROM users WHERE user_id = ?",
      [req.user.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const user = rows[0];

    const [accessRows] = await db.execute(
      `SELECT uca.company_id, uca.branch_id, c.trade_name AS company_name, b.branch_name
       FROM user_company_access uca
       JOIN companies c ON c.company_id = uca.company_id
       LEFT JOIN branches b ON b.branch_id = uca.branch_id
       WHERE uca.user_id = ? AND uca.status = 'active'`,
      [user.user_id]
    );

    const [roleRows] = await db.execute(
      `SELECT ur.role_id, r.role_name, ur.company_id, ur.branch_id
       FROM user_roles ur
       JOIN roles r ON r.role_id = ur.role_id
       WHERE ur.user_id = ? AND ur.status = 'active'`,
      [user.user_id]
    );

    res.json({
      success: true,
      data: {
        user: {
          userId: user.user_id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          status: user.status,
          createdAt: user.created_at,
        },
        access: accessRows,
        roles: roleRows,
      },
    });
  } catch (error) {
    next(error);
  }
}
