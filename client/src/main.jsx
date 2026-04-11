import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import ResultsPage from './pages/ResultsPage.jsx';

const isResults = window.location.pathname === '/results';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isResults ? <ResultsPage /> : <App />}
  </StrictMode>
);
