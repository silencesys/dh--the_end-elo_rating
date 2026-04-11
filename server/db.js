const mongoose = require('mongoose');
const { seedImages, generatePreviews } = require('./startup');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/elo-rating';

mongoose.connection.once('open', () => {
  seedImages().catch((err) => console.error('Seeding error:', err.message));
  generatePreviews().catch((err) => console.error('Preview generation error:', err.message));
});

function connect() {
  return mongoose
    .connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => {
      console.error('MongoDB connection error:', err.message);
      process.exit(1);
    });
}

module.exports = { connect };
