/** A connection owned by one lesson panel. */
export interface CloseableConnection { close: () => void; }

export type ActionResult<T> =
  | { status: "completed"; value: T }
  | { status: "busy" | "disposed" };

/** Own a panel connection and serialize scene-changing learner actions. */
export class LessonPanelLifecycle<TConnection extends CloseableConnection> {
  private connection: TConnection | null = null;
  private isActionPending = false;
  private disposed = false;

  /** Connect once; a connection that arrives after disposal is immediately closed. */
  async connect(factory: () => Promise<TConnection>): Promise<TConnection | null> {
    const connection = await factory();
    if (this.disposed) {
      connection.close();
      return null;
    }
    this.connection = connection;
    return connection;
  }

  /** Run one learner action while rejecting concurrent or post-disposal work. */
  async runExclusive<TResult>(action: () => Promise<TResult>): Promise<ActionResult<TResult>> {
    if (this.disposed) return { status: "disposed" };
    if (this.isActionPending) return { status: "busy" };
    this.isActionPending = true;
    try {
      return { status: "completed", value: await action() };
    } finally {
      this.isActionPending = false;
    }
  }

  /** Mark the panel closed and release its established connection exactly once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connection?.close();
    this.connection = null;
  }

  /** Whether the panel has been closed. */
  isDisposed(): boolean { return this.disposed; }
}
