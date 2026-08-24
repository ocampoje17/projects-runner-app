import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in React component tree:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-3 bg-[var(--vscode-editor)] p-6 text-foreground">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle size={24} />
          </div>
          <div className="text-center">
            <h2 className="text-[14px] font-semibold">Something went wrong</h2>
            <p className="mt-1 max-w-[480px] text-[12px] text-muted-foreground">
              {this.state.error?.message || "An unexpected rendering error occurred."}
            </p>
          </div>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" size="sm" onClick={this.handleReset}>
              Try Again
            </Button>
            <Button size="sm" onClick={this.handleReload}>
              <RefreshCw size={14} className="mr-1.5" />
              Reload App
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
