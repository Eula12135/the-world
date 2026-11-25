import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** 连续失败次数：用来判断「尝试恢复」是否还值得再点一次 */
  attempts: number;
}

/** 连续失败达到该次数后只保留「重新加载」，避免用户反复点恢复却一直在崩 */
const MAX_INPLACE_RETRIES = 2;

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, attempts: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
    // getDerivedStateFromError 必须是纯函数，计数放在这里
    this.setState((prev) => ({ attempts: prev.attempts + 1 }));
  }

  private handleReset = () => {
    if (this.state.attempts >= MAX_INPLACE_RETRIES) return;
    this.setState({ error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  componentDidUpdate(_prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState): void {
    // 上一次还是错误态、这一次已经渲染成功 → 说明恢复有效，重置连续失败计数
    if (prevState.error && !this.state.error && this.state.attempts > 0) {
      this.setState({ attempts: 0 });
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="h-full w-full flex items-center justify-center bg-canvas text-ink p-4">
        <div className="max-w-md w-full rounded-xl border border-line bg-card p-6 space-y-4 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger/10 text-danger flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-ink">页面渲染出现异常</h2>
              <p className="text-[13px] text-secondary leading-relaxed">
                {this.state.attempts < MAX_INPLACE_RETRIES
                  ? '本地数据未被清除。你可以先尝试恢复界面，或刷新重新加载应用。'
                  : '本地数据未被清除。界面已连续恢复失败，请点「重新加载」重启应用。'}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-muted border border-line px-3 py-2 text-[13px] text-secondary font-mono break-all max-h-28 overflow-y-auto">
            {this.state.error.message || '未知渲染错误'}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            {this.state.attempts < MAX_INPLACE_RETRIES && (
              <button
                type="button"
                onClick={this.handleReset}
                className="px-3.5 py-2 rounded-xl text-[13px] border border-line text-secondary hover:bg-hover hover:text-ink transition cursor-pointer"
              >
                尝试恢复
              </button>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium bg-accent text-white hover:opacity-95 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重新加载</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
