import {
  _decorator,
  Component,
  Node,
  screen,
  UITransform,
  UIOpacity,
  Vec3,
  view,
} from "cc";
import { NezpOverlayRoot } from "./NezpOverlayRoot";

const { ccclass, property } = _decorator;

/**
 * 按 bundle 行为还原：DOM 跟随 Cocos 节点的基础组件。
 * 作用：提供一个会随节点移动/缩放/旋转/透明度变化的 parent DOM，供 OverlayView iframe 挂载。
 */
@ccclass("NezpHtmlElementBase")
export class NezpHtmlElementBase extends Component {
  @property
  zIndex = 1000;

  protected _shouldShow = true;
  protected parentElement: NezpHtmlElementBase | null = null;
  protected _htmlElement: HTMLElement | null = null;

  protected initialFrameWidth = 0;
  protected initialFrameHeight = 0;
  protected isInitializedWhenCanvasFitWidth: boolean | undefined = undefined;

  protected updateTypeSet = new Set<number>(); // 0=scale,1=rotation,2=position,3=opacity

  protected latestWorldPosition = { x: -5000, y: -5000 };
  protected latestWorldScale = { x: 1, y: 1 };
  protected latestWorldAngle = 0;
  protected latestWorldOpacity = 255;

  protected hasInitedPosition = false;
  protected hasInitedScale = false;
  protected hasInitedAngle = false;
  protected hasInitedOpacity = false;

  protected _lastParent: Node | null = null;

  get htmlElement(): HTMLElement | null {
    return this._htmlElement;
  }

  onLoad() {
    this.updateFrameRatio();
  }

  onEnable() {
    this.node.on(Node.EventType.SIZE_CHANGED, this.onSizeChanged, this);
    this.node.on(Node.EventType.TRANSFORM_CHANGED, this.updateRPSChanged, this);
    view.on("canvas-resize", this.onCanvasResize, this);

    this.onParentChanged();

    if (this._shouldShow) {
      // 如果 DOM 已存在，直接恢复显示；否则创建新的
      if (this._htmlElement) {
        this._htmlElement.style.display = "block";
        this.adjustElementSize();
        this.updateHtmlElementTransform();
      } else {
        this.createHtmlElement("div");
        this.adjustElementSize();
        // ✅ 新创建 DOM 时也需要更新位置，解决动态创建节点位置不正确的问题
        this.updateHtmlElementTransform();
      }
    }
  }

  onDisable() {
    this.node.off(Node.EventType.SIZE_CHANGED, this.onSizeChanged, this);
    this.node.off(Node.EventType.TRANSFORM_CHANGED, this.updateRPSChanged, this);
    view.off("canvas-resize", this.onCanvasResize, this);
    // 禁用时只隐藏 DOM，不移除（避免切换 Tab 时销毁重建）
    // DOM 的移除只在 onDestroy 中进行
    if (this._htmlElement) {
      this._htmlElement.style.display = "none";
    }
  }

  onDestroy() {
    this.removeHtmlElement();
  }

  update() {
    if (!this._htmlElement) return;

    const p = this.node.parent;
    if (p && this._lastParent !== p) {
      this._lastParent = p;
      this.onParentChanged();
    }

    const opacity = this.getElementOpacity();
    if (!this.hasInitedOpacity || opacity !== this.latestWorldOpacity) {
      this.updateTypeSet.add(3);
      this.latestWorldOpacity = opacity;
      this.hasInitedOpacity = true;
    }

    if (this.updateTypeSet.size > 0) {
      this.updateHtmlElementTransform();
      this.updateTypeSet.clear();
    }
  }

  /**
   * 在 lateUpdate 中强制同步位置，确保在 Cocos 完成所有节点变换后更新 DOM。
   * 这对于 ScrollView 等父节点移动导致的世界坐标变化尤其重要。
   */
  lateUpdate() {
    if (!this._htmlElement) return;
    // 每帧强制同步位置，消除抖动和延迟
    this.updateHtmlElementTransform();
  }

  show() {
    this._shouldShow = true;
    if (this._htmlElement) {
      this._htmlElement.style.display = "block";
    } else {
      this.createHtmlElement("div");
      this.adjustElementSize();
    }
  }

  hide() {
    this._shouldShow = false;
    if (this._htmlElement) this._htmlElement.style.display = "none";
  }

  protected onCanvasResize() {
    this.updateFrameRatio();
    this.adjustElementSize();
    this.updateTypeSet.add(0);
    this.updateTypeSet.add(2);
  }

  protected onSizeChanged() {
    this.updateFrameRatio();
    this.adjustElementSize();
  }

  protected updateRPSChanged(bit?: number) {
    // bundle 在不同 bit 下做不同处理；这里为保持一致性：position/scale 立即，rotation 延后
    this.updatePositionChanged();
    this.updateScaleChanged();
    this.updateRotationChanged();
  }

  protected updatePositionChanged() {
    this.updateTypeSet.add(2);
    this.updateHtmlElementTransform();
  }

  protected updateScaleChanged() {
    this.updateTypeSet.add(0);
    this.updateTypeSet.add(2);
    this.updateHtmlElementTransform();
  }

  protected updateRotationChanged() {
    this.updateTypeSet.add(1);
  }

  protected createHtmlElement(tagName: string = "div"): HTMLElement {
    if (this._htmlElement) this.removeHtmlElement();

    const el = this.buildHtmlElement(tagName);
    this._htmlElement = el;

    const ui = this.node.getComponent(UITransform);
    if (ui) {
      el.style.transformOrigin = `${(ui.anchorX * 100).toFixed(0)}% ${((1 - ui.anchorY) * 100).toFixed(0)}%`;
    }

    this.latestWorldPosition = this.getElementPosition();
    this.hasInitedPosition = true;
    el.style.transform = `translate(-50%, -50%) translate(${this.latestWorldPosition.x.toFixed(1)}px, ${this.latestWorldPosition.y.toFixed(1)}px)`;

    const parentEl = this.parentElement?.htmlElement;
    if (parentEl) parentEl.appendChild(el);
    else NezpOverlayRoot.ensureRoot().appendChild(el);

    this.updateHtmlElementTransform();
    return el;
  }

  protected buildHtmlElement(tagName: string): HTMLElement {
    const el = document.createElement(tagName);
    el.id = `nezp-anchor-${this.node.name}-${Date.now()}`;
    el.style.position = "absolute";
    el.style.top = "0px";
    el.style.left = "0px";
    el.style.zIndex = this.zIndex.toString();
    el.style.pointerEvents = "none";
    return el;
  }

  protected removeHtmlElement() {
    if (!this._htmlElement) return;
    const el = this._htmlElement;
    this._htmlElement = null;
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  protected updateFrameRatio() {
    const design = view.getDesignResolutionSize();
    const frame = this.getCanvasFrame();

    // bundle 这里用 contentStrategy==FIXED_WIDTH 来分支；
    // 在 Cocos 3.x 我们按“横竖比”推断并保持一致（尽量贴 bundle 行为）
    // 你也可以在项目里把这个改成读取 Canvas.fitWidth。
    this.initialFrameWidth = frame.width;
    this.initialFrameHeight = frame.height;

    // 简单推断：宽高比更接近 frame/design 的哪一边
    const ratioW = frame.width / design.width;
    const ratioH = frame.height / design.height;
    this.isInitializedWhenCanvasFitWidth = ratioW <= ratioH;
  }

  /** bundle：像素尺寸 */
  getElementSize(): { width: number; height: number } {
    const ui = this.node.getComponent(UITransform);
    if (!ui) return { width: 0, height: 0 };

    const design = view.getDesignResolutionSize();
    const frame = this.getCanvasFrame();

    const refFrameW = this.parentElement ? this.parentElement.initialFrameWidth : frame.width;
    const refFrameH = this.parentElement ? this.parentElement.initialFrameHeight : frame.height;

    const fitWidth = this.isInitializedWhenCanvasFitWidth === true;

    if (fitWidth) {
      const w = ui.width * (refFrameW / design.width);
      const h = w * (ui.height / ui.width);
      return { width: w, height: h };
    } else {
      const h = ui.height * (refFrameH / design.height);
      const w = h * (ui.width / ui.height);
      return { width: w, height: h };
    }
  }

  /** bundle：像素位置（用于 CSS translate） */
  getElementPosition(): { x: number; y: number } {
    const world = this.node.getWorldPosition();
    const ui = this.node.getComponent(UITransform);
    if (!ui) return { x: 0, y: 0 };

    const design = view.getDesignResolutionSize();
    const frame = this.getCanvasFrame();

    const fitWidth = this.isInitializedWhenCanvasFitWidth === true;
    const ratio = fitWidth ? frame.width / design.width : frame.height / design.height;

    const size = this.getElementSize();
    const anchorOffsetX = (0.5 - ui.anchorX) * size.width;
    const anchorOffsetY = (ui.anchorY - 0.5) * size.height;

    if (this.parentElement) {
      const parentWorld = this.parentElement.getElementNodeWorldPosition();
      const parentSize = this.parentElement.getElementSize();
      const parentUi = this.parentElement.node.getComponent(UITransform);

      const parentAnchorX = parentUi ? parentUi.anchorX : 0.5;
      const parentAnchorY = parentUi ? parentUi.anchorY : 0.5;

      const parentLeftOffset = (0 - parentAnchorX) * parentSize.width;
      const parentTopOffset = (1 - parentAnchorY) * parentSize.height;

      const parentPxX = parentWorld.x * ratio + parentLeftOffset;
      const parentPxY = frame.height - (parentWorld.y * ratio + parentTopOffset);

      return {
        x: world.x * ratio + anchorOffsetX - parentPxX,
        y: frame.height - (world.y * ratio - anchorOffsetY) - parentPxY,
      };
    }

    return {
      x: frame.left + world.x * ratio + anchorOffsetX,
      y: frame.top + frame.height - (world.y * ratio - anchorOffsetY),
    };
  }

  /** Overlay 根节点使用浏览器坐标；游戏内的尺寸必须以实际 Canvas 为准。 */
  protected getCanvasFrame(): { width: number; height: number; left: number; top: number } {
    const canvas = document.querySelector("canvas");
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
      }
    }
    return { width: screen.windowSize.width, height: screen.windowSize.height, left: 0, top: 0 };
  }

  getElementNodeWorldPosition(): Vec3 {
    return this.node.getWorldPosition();
  }

  getElementAngle(): number {
    let a = 0;
    let n: Node | null = this.node;
    while (n) {
      a += n.eulerAngles.z;
      n = n.parent;
    }
    return a;
  }

  getElementScale(): { x: number; y: number } {
    let sx = 1;
    let sy = 1;

    const stopNode = this.parentElement ? this.parentElement.node : null;
    let n: Node | null = this.node;
    while (n && n !== stopNode) {
      sx *= n.scale.x;
      sy *= n.scale.y;
      n = n.parent;
    }

    return { x: sx, y: sy };
  }

  getElementOpacity(): number {
    let opacity = 255;
    let n: Node | null = this.node;
    while (n) {
      const uiOpacity = n.getComponent(UIOpacity);
      const o = uiOpacity ? uiOpacity.opacity : 255;
      opacity *= (o ?? 255) / 255;
      n = n.parent;
    }

    return opacity;
  }

  protected updateHtmlElementTransform() {
    if (!this._htmlElement) return;

    // position
    this.latestWorldPosition = this.getElementPosition();
    this.hasInitedPosition = true;

    let transform = `translate(-50%, -50%) translate(${this.latestWorldPosition.x.toFixed(1)}px, ${this.latestWorldPosition.y.toFixed(1)}px)`;

    // angle
    this.latestWorldAngle = this.getElementAngle();
    this.hasInitedAngle = true;
    transform += ` rotate(${(-this.latestWorldAngle).toFixed(1)}deg)`;

    // scale
    this.latestWorldScale = this.getElementScale();
    this.hasInitedScale = true;
    transform += ` scale(${this.latestWorldScale.x.toFixed(1)}, ${this.latestWorldScale.y.toFixed(1)})`;

    this._htmlElement.style.transform = transform;
    this._htmlElement.style.opacity = (this.latestWorldOpacity / 255).toFixed(2);

  }

  protected onParentChanged() {
    let p = this.node.parent;
    let found: NezpHtmlElementBase | null = null;
    while (p) {
      const comp = p.getComponent(NezpHtmlElementBase);
      if (comp) {
        found = comp;
        break;
      }
      p = p.parent;
    }
    this.parentElement = found;
  }

  protected adjustElementSize() {
    if (!this._htmlElement) return;
    const s = this.getElementSize();
    // 关键点：必须让 parentElement 具有可见尺寸。
    // FBInstant.overlayViews 会把 iframe append 到 iframeParentElement 里，并以 100%/绝对定位等方式布局。
    // parentElement 若保持 0x0，会导致 iframe 计算尺寸为 0 或出现不可预期的裁剪/渲染问题。
    this._htmlElement.style.width = `${s.width}px`;
    this._htmlElement.style.height = `${s.height}px`;
  }
}
