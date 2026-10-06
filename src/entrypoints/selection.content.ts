import { startSelection } from '@/lib/selection/content.js';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  allFrames: false,
  main() { startSelection(); },
});
