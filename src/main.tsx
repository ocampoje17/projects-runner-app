import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { TwofaProvider } from "./components/twofa/TwofaProvider";
import { migrateLocalStorageTwofaState } from "./lib/sidebar-state";
import "./styles/tailwind.css";
import "devicon/devicon.min.css";
import "./App.css";

migrateLocalStorageTwofaState();

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TwofaProvider>
          <App />
        </TwofaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
