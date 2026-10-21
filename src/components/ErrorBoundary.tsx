import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, ArrowLeft, ShieldCheck } from 'lucide-react';
import '../design/errors.css';

export interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
  resetKey?: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.props.resetKey !== prevProps.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-panel" role="alert" aria-live="assertive">
          <div className="error-boundary-card">
            <div className="error-boundary-icon-wrapper" aria-hidden="true">
              <AlertTriangle className="error-boundary-icon" />
            </div>
            <h1 className="error-boundary-title">This tool stopped responding</h1>
            <p className="error-boundary-message">An unexpected error occurred while running this tool.</p>
            <div className="error-boundary-privacy-notice">
              <ShieldCheck className="error-boundary-privacy-icon" aria-hidden="true" />
              <span>Your files stayed on your device and were never uploaded or transmitted.</span>
            </div>
            <div className="error-boundary-actions">
              <button type="button" className="btn btn-primary" onClick={this.handleReset}>
                <RefreshCw aria-hidden="true" />
                Try again
              </button>
              <Link to="/" className="btn btn-secondary">
                <ArrowLeft aria-hidden="true" />
                Back to all tools
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Functional wrapper that resets the ErrorBoundary whenever the route pathname changes.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname} resetKey={location.pathname}>
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
