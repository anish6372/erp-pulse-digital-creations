'use client';
import { useEffect } from 'react';

// Public, no-login screens (new joiner onboarding wizard, client content review).
export default function PublicBridge({ kind, token }) {
  useEffect(() => {
    document.body.classList.add('app');
    (async () => {
      if (kind === 'onboard') (await import('../legacy/pages/onboardingPublic.js')).startOnboarding(token);
      else (await import('../legacy/pages/reviewPublic.js')).startReview(token);
    })();
  }, [kind, token]);
  return <div id="onboard" className="onboard hidden" />;
}
