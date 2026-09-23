import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import './i18n';
import { ScoutXAuth0Provider } from './auth/ScoutXAuth0Provider';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <ScoutXAuth0Provider>
    <App />
  </ScoutXAuth0Provider>
);
