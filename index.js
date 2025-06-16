const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.post('/connection_token', async (req, res) => {
  try {
    const connectionToken = await stripe.terminal.connectionTokens.create();
    res.json(connectionToken);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
