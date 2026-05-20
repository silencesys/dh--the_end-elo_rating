const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    catNo: { type: Number, default: null },
    originPlace: { type: String, default: null },
    originDate: { type: String, default: null },
    folioNumbers: { type: Number, default: null },
    languages: { type: [String], default: [] },
    genres: { type: [String], default: [] },
    tagsTime: { type: String, default: null },
    tagsForm: { type: String, default: null },
    catalogue: { type: String, default: null },
    eloRating: { type: Number, default: 1500 },
    comparisons: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Image', imageSchema);
