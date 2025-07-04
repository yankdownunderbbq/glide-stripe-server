const required = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_TERMINAL_WEBHOOK_SECRET',
  'GLIDE_QUOTE_WEBHOOK_URL',
  'GLIDE_QUOTE_WEBHOOK_TOKEN',
  'GLIDE_TERMINAL_WEBHOOK_URL',
  'GLIDE_TERMINAL_WEBHOOK_TOKEN',
  'GLIDE_SHARED_SECRET'
];

module.exports = function validateEnv() {
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};
