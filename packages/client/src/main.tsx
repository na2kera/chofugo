import './styles/global.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installFrames } from './pixel/frames.ts';

installFrames();
createRoot(document.getElementById('root')!).render(<App />);
