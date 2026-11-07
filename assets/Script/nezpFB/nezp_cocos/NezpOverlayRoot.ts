export class NezpOverlayRoot {
  static readonly ROOT_ID = "OverlayViewParent";

  static ensureRoot(): HTMLElement {
    let root = document.getElementById(NezpOverlayRoot.ROOT_ID) as HTMLElement | null;
    if (!root) {
      root = document.createElement("div");
      root.id = NezpOverlayRoot.ROOT_ID;
      // 用 fixed + 超高 z-index，确保 Overlay 永远在 Cocos Canvas 之上
      // 也能匹配 FB Instant "Shield Overlay" 的典型层级行为
      root.style.position = "fixed";
      root.style.left = "0px";
      root.style.top = "0px";
      root.style.width = "100vw";
      root.style.height = "100vh";
      root.style.pointerEvents = "none";
      root.style.overflow = "visible";
      root.style.zIndex = "2147483647";
      // 提示浏览器做合成层，避免偶发层级/闪烁问题
      (root.style as any).transform = "translateZ(0)";
      // 插到 body 最末尾，确保 DOM 顺序也在最上层
      document.body.appendChild(root);
    }
    return root;
  }
}
