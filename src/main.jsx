import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { AuthProvider } from './context/AuthContext.jsx';
import { TaskProvider } from './context/TaskContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { EventsProvider } from './context/EventsContext.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <EventsProvider>
          <TaskProvider>
            <App />
          </TaskProvider>
        </EventsProvider>
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>
);
