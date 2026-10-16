import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './vscode.css';
import './results.css';
import './decisions.css';
import './storage-charts.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
