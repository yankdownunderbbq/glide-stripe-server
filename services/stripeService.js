const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { sendToGlide } = require('./glideService');

const processedPayments = new Set();

// Handle /webhook-quotes
async function handleQuoteWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Invalid webhook signature:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const paymentIntentId = session.payment_intent;
    const quoteId = session.metadata.quote_id;
    const paymentType = session.metadata.payment_mode || 'unspecified';

    if (processedPayments.has(paymentIntentId)) {
      return res.status(200).send('Duplicate event ignored');
    }

    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const charge = pi.charges?.data?.[0];

      processedPayments.add(pi.id);

      const payload = {
        quote_id: quoteId,
        payment_intent_id: pi.id,
        amount_paid: pi.amount_received,
        currency: pi.currency,
        status: pi.status,
        receipt_url: charge?.receipt_url || '',
        paid: pi.status === 'succeeded',
        payment_type: paymentType,
      };

      await sendToGlide(payload, 'quote');
      return res.status(200).send('Webhook processed');
    } catch (err) {
      console.error('❌ Failed to process quote payment:', err.message);
      return res.status(500).send('Internal error');
    }
  }

  res.status(200).send('Event ignored');
}

module.exports = {
  handleQuoteWebhook,
  // other functions coming next...
};
