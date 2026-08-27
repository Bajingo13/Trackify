function errorHandler(error, req, res, next) {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === "development" ? error.message : "Internal server error.",
  });
}

export default errorHandler;
