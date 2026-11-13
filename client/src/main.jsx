import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import 'leaflet/dist/leaflet.css';
import { AuthProvider } from './auth/AuthProvider.jsx';
import { OriginProvider } from './location/OriginProvider.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <OriginProvider>
          <App />
        </OriginProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
