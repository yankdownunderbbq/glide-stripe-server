module.exports = function errorHandler(err, req, res, next) {
  console.error('❌ Uncaught Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
};
