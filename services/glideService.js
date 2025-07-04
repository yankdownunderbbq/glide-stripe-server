const axios = require('axios');

function getGlideConfig(type = 'quote') {
  const url = type === 'terminal' ? process.env.GLIDE_TERMINAL_WEBHOOK_URL : process.env.GLIDE_QUOTE_WEBHOOK_URL;
  const token = type === 'terminal' ? process.env.GLIDE_TERMINAL_WEBHOOK_TOKEN : process.env.GLIDE_QUOTE_WEBHOOK_TOKEN;

  if (!url || !token) {
    throw new Error(`❌ Missing Glide webhook config for type "${type}"`);
  }

  return { url, token };
}

async function sendToGlide(payload, type = 'quote') {
  const { url, token } = getGlideConfig(type);

  return axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

module.exports = {
  sendToGlide,
};
