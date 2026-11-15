"use client";

import { Component, type ReactNode } from "react";

/**
 * Catches an error thrown while drawing a map and shows `fallback` instead, so a map problem can never take the
 * rest of the page (the order, the status, the confirm button) down with it.
 */
export default class MapBoundary extends Component<{ children: ReactNode; fallback: (error: Error) => ReactNode; onError?: (error: Error) => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }
  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
