/**
 * Dashboard tab + one tab per open file. Populated in 1.8.
 *
 * Sits at the very top of the window: the native title bar is removed
 * (titleBarStyle "Overlay") so the traffic lights sit inside this bar rather
 * than in a strip above it. Empty space here drags the window.
 */
export function TabBar() {
  return (
    <div className="tabbar" data-tauri-drag-region>
      <span className="region-stub no-drag">Tab bar</span>
      <div className="tabbar-drag" data-tauri-drag-region />
    </div>
  );
}
