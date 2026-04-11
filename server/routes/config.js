const { Router } = require('express');

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    appTitle:          process.env.APP_TITLE           || 'ELO Rating',
    question:          process.env.QUESTION            || 'Which image do you prefer?',
    questionDescription: process.env.QUESTION_DESCRIPTION || '',
    timePerComparison: parseInt(process.env.TIME_PER_COMPARISON  || '5000', 10),
    preloadCount:      parseInt(process.env.PRELOAD_COUNT        || '6',    10),
    sessionPairsLimit: parseInt(process.env.SESSION_PAIRS_LIMIT  || '0',    10),
    eloNReplays:       parseInt(process.env.ELO_N_REPLAYS        || '100',   10),
    chartImageLimit:   parseInt(process.env.CHART_IMAGE_LIMIT    || '0',    10),
  });
});

module.exports = router;
