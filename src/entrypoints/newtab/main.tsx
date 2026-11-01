import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../components/App';
import { FeedbackProvider } from '../../components/ui';
import { collectUnusedImages, followRestores } from '../../lib/actions';
import { loadState } from '../../lib/store';
import '../../styles/app.css';

await loadState();

// Set before the first paint, so nothing shows up and then fades in. App clears it.
document.documentElement.classList.add('opening');

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  </StrictMode>,
);

void collectUnusedImages();
followRestores();
