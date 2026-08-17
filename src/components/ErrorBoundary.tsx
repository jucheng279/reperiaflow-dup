import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info);
    }
  }

  handleRecover = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-100 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="w-full max-w-md rounded-lg border border-red-300 bg-white p-6 shadow-lg dark:border-red-500/50 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2 text-red-600 dark:text-red-300">
            <AlertTriangle size={20} />
            <h2 className="text-base font-semibold">Something went wrong</h2>
          </div>
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
            The viewer hit an unexpected error and was prevented from blanking the page.
          </p>
          <pre className="mb-4 max-h-40 overflow-auto rounded bg-slate-100 p-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {error.message}
          </pre>
          <button
            onClick={this.handleRecover}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 dark:bg-cyan-500 dark:text-slate-900 dark:hover:bg-cyan-400"
          >
            <RefreshCw size={14} />
            Recover
          </button>
        </div>
      </div>
    );
  }
}
