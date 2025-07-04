module.exports = function logger(req, res, next) {
  console.log(`📡 ${req.method} ${req.originalUrl}`);
  next();
};
