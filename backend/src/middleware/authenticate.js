import jwt from "jsonwebtoken";

function authenticate(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  const token = authorization.substring(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Driver App tokens are signed with the same secret but carry `kind:"driver"`
    // and no userId — they must not unlock staff routes.
    if (payload.kind === "driver" || !payload.userId) {
      return res.status(401).json({
        success: false,
        message: "This token can't be used here.",
      });
    }
    req.user = { userId: Number(payload.userId), email: payload.email || null };
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
    });
  }
}

export default authenticate;
