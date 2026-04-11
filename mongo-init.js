// Runs once on first container start (when /data/db is empty).
// Creates a least-privilege user scoped to the elo-rating database.
// Credentials are injected via MONGO_APP_USER / MONGO_APP_PASSWORD env vars
// set in docker-compose.yml from the .env file.

db = db.getSiblingDB('elo-rating');

db.createUser({
  user: process.env.MONGO_APP_USER,
  pwd:  process.env.MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: 'elo-rating' }],
});
