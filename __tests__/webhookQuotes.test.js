const httpMocks = require('node-mocks-http');
const axios = require('axios');
const stripe = require('stripe');
const stripeService = require('../services/stripeService');

jest.mock('stripe');
jest.mock('axios');

describe('📦 Webhook - /webhook-quotes', () => {
  let req, res, stripeMock;

  beforeEach(() => {
    req = httpMocks.createRequest({
      method: 'POST',
      url: '/webhook-quotes',
      headers: {
        'stripe-signature': 'mock-signature',
      },
      body: Buffer.from('{}'), // Stripe requires raw buffer
    });

    res = httpMocks.createResponse();

    // Mock Stripe instance
    stripeMock = {
      webhooks: {
        constructEvent: jest.fn(),
      },
      paymentIntents: {
        retrieve: jest.fn(),
      },
    };

    // Override stripe() call to return the mock
    stripe.mockReturnValue(stripeMock);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('✅ handles checkout.session.completed and sends to Glide', async () => {
    // Step 1: Mock the webhook event
    const mockSession = {
      payment_intent: 'pi_123',
      metadata: {
        quote_id: 'quote_abc123',
        payment_mode: 'full',
      },
    };

    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: mockSession,
      },
    });

    // Step 2: Mock the PaymentIntent returned from Stripe
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_123',
      amount_received: 32500,
      currency: 'aud',
      status: 'succeeded',
      charges: {
        data: [{ receipt_url: 'https://stripe.com/receipt/pi_123' }],
      },
    });

    // Step 3: Mock sending to Glide
    axios.post.mockResolvedValue({ data: 'glide-ok' });

    // Step 4: Call the webhook handler
    await stripeService.handleQuoteWebhook(req, res);

    // ✅ Expect 200 response
    expect(res.statusCode).toBe(200);
    expect(res._getData()).toBe('Webhook processed');

    // ✅ Confirm Stripe webhook was verified
    expect(stripeMock.webhooks.constructEvent).toHaveBeenCalled();

    // ✅ Confirm PaymentIntent retrieved
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith('pi_123');

    // ✅ Confirm Glide was called with expected payload
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/.*glide/i),
      expect.objectContaining({
        quote_id: 'quote_abc123',
        amount_paid: 32500,
        currency: 'aud',
        paid: true,
        payment_type: 'full',
        status: 'succeeded',
        receipt_url: expect.stringContaining('receipt'),
      }),
      expect.anything() // headers
    );
  });

  it('❌ returns 400 on invalid Stripe signature', async () => {
    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    await stripeService.handleQuoteWebhook(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getData()).toContain('Webhook Error');
  });

  it('❌ returns 500 if Stripe PaymentIntent fails', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_intent: 'pi_broken',
          metadata: { quote_id: 'fail', payment_mode: 'full' },
        },
      },
    });

    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('Stripe failure'));

    await stripeService.handleQuoteWebhook(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getData()).toContain('Internal error');
  });
});
