import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl m-4 z-[9999] relative">
          <h2 className="text-red-700 font-bold mb-2">Something went wrong.</h2>
          <details className="whitespace-pre-wrap text-xs text-red-600 font-mono bg-white p-2 rounded">
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
          <button onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">
            Dismiss
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
