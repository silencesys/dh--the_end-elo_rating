const mongoose = require('mongoose');
const { runStartup } = require('./startup');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/elo-rating';

function connect() {
  return mongoose
    .connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => {
      console.error('MongoDB connection error:', err.message);
      process.exit(1);
    });
}

async function connectAndPrepare() {
  await connect();
  await runStartup();
}

module.exports = { connect, connectAndPrepare };
