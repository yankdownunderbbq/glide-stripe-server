const { sendToGlide } = require('../services/glideService');
const axios = require('axios');
jest.mock('axios');

describe('sendToGlide', () => {
  beforeEach(() => {
    process.env.GLIDE_QUOTE_WEBHOOK_URL = 'https://mock.glide/quote';
    process.env.GLIDE_QUOTE_WEBHOOK_TOKEN = 'mock-token';
  });

  it('posts to the correct URL with token', async () => {
    const payload = { test: 'data' };
    axios.post.mockResolvedValue({ data: 'ok' });

    const response = await sendToGlide(payload, 'quote');

    expect(axios.post).toHaveBeenCalledWith(
      'https://mock.glide/quote',
      payload,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
        }),
      })
    );

    expect(response.data).toBe('ok');
  });
});
