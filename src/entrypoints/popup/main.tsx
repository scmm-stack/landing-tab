import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from '../../components/Popup';
import { FeedbackProvider } from '../../components/ui';
import { loadState } from '../../lib/store';
import '../../styles/app.css';

await loadState();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <FeedbackProvider>
      <Popup />
    </FeedbackProvider>
  </StrictMode>,
);
