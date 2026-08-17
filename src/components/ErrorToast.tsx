import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';

export function ErrorToast() {
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error, setError]);

  if (!error) return null;
  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-lg dark:border-red-500/60 dark:bg-red-950/90 dark:text-red-100">
      <span className="flex-1">{error}</span>
      <button aria-label="Dismiss" onClick={() => setError(null)} className="text-red-600 hover:text-red-900 dark:text-red-200 dark:hover:text-white">
        <X size={14} />
      </button>
    </div>
  );
}
