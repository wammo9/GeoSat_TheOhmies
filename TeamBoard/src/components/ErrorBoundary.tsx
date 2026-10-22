import { Component, type ReactNode } from 'react';

/** Shows a readable message (instead of a blank page) if a screen crashes while rendering. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error) { console.error('[GeoSat board] screen crashed:', error); }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); // navigating away clears it
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel crash" role="alert">
        <h2>Something went wrong on this screen</h2>
        <p>The rest of the board is fine. You can go back, or reload the page.</p>
        <p className="muted small-text break">{this.state.error.message}</p>
        <div className="row">
          <button className="primary" onClick={() => location.reload()}>Reload the page</button>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
        <p className="muted small-text">If this keeps happening after a new version went live, your database may need a one-time update; see the yellow notice at the top of the page if one appears.</p>
      </div>
    );
  }
}
