/**
 * 浮层返回栈。
 *
 * 安卓返回键要先关「最上面那层」：模型下拉、上下文浮层、图片大图、手机侧栏抽屉、
 * 甚至是模型配置页里再弹出的选择框。这些都不是 store 里的 activeModal，
 * 只判断 modal / view 会把整页一起关掉、或者直接退出 App。
 *
 * 每个浮层打开时把自己的关闭函数压进来，卸载/关闭时移出；App 的返回键先问这里。
 */
const handlers: Array<() => void> = [];

/** 压入一层，返回移除函数（放进 useEffect 的 cleanup 即可） */
export function pushBackLayer(close: () => void): () => void {
  handlers.push(close);
  return () => {
    const index = handlers.lastIndexOf(close);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/** 关掉最上面一层；返回 false 表示当前没有浮层 */
export function closeTopBackLayer(): boolean {
  const close = handlers.pop();
  if (!close) return false;
  close();
  return true;
}

export function hasBackLayer(): boolean {
  return handlers.length > 0;
}
