// One sentence for the user from a failed API call. Shared by every page so a 401, 429 or 502
// reads the same everywhere. Never shows server internals.
//
// byCode: page-specific wording for a server error code ({ no_profile: '...' }). Checked first.

// "about 4 minutes" / "about 30 seconds" / "about 7 hours", from a Retry-After value in seconds.
export function formatWait(seconds) {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  if (seconds >= 3600) {
    const hours = Math.ceil(seconds / 3600);
    return `about ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export function errorMessage(err, byCode = {}) {
  const code = err?.data?.code;
  if (code && byCode[code]) return byCode[code];

  if (err?.network) return 'Could not reach the server. Check your connection and try again.';

  switch (err?.status) {
    case 401:
      // The session banner (SessionExpiredBanner) offers sign-in; this explains why the action failed.
      return 'Your session expired. Sign in again from the banner above, then retry. Nothing on this page was lost.';
    case 429: {
      // The daily AI budget: the server's sentence already says how many runs and when it resets.
      if (code === 'daily_limit' && err.data?.error) return err.data.error;
      const wait = formatWait(err.retryAfter);
      return wait
        ? `You have hit the limit for this action. Try again in ${wait}.`
        : 'You have hit the limit for this action. Wait a few minutes and try again.';
    }
    case 413:
      return 'That is too much to send at once. Shorten it and try again.';
    case 502:
      return 'The AI service did not answer. This is usually brief: wait a minute and try again.';
    case 503: {
      const wait = formatWait(err.retryAfter);
      return err.data?.error ?? `The server is busy. Try again${wait ? ` in ${wait}` : ' shortly'}.`;
    }
    case 504:
      return err.data?.error ?? 'The server took too long to answer. Try again.';
    default:
      // 4xx messages from our own server are written for users; anything else gets a generic line.
      return err?.status && err.status < 500 && err.data?.error ? err.data.error : 'Something went wrong. Try again.';
  }
}
