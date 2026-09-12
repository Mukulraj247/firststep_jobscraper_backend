import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import i18n from './i18n';
import { ScoutXAuth0Provider } from './auth/ScoutXAuth0Provider';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <ScoutXAuth0Provider>
        <App />
      </ScoutXAuth0Provider>
    </BrowserRouter>
  </React.StrictMode>
);

