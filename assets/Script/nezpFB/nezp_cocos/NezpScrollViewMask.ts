import { _decorator, Node, UITransform, view } from "cc";
import { NezpHtmlElementBase } from "./NezpHtmlElementBase";
import { NezpOverlayRoot } from "./NezpOverlayRoot";

const { ccclass, property } = _decorator;

/**
 * ScrollView 遮罩容器
 * 在 ScrollView 节点上创建一个带 overflow: hidden 的 DOM 容器，
 * 使内部的 Overlay 元素能够被正确裁剪，不超出可视区域。
 * 
 * 使用方法：
 * 1. 将此组件挂载到 ScrollView 节点上
 * 2. 确保 RankItemView 中的 NezpOverlayAnchor 会自动成为此容器的子元素
 */
@ccclass("NezpScrollViewMask")
export class NezpScrollViewMask extends NezpHtmlElementBase {
    protected createHtmlElement(tagName: string = "div"): HTMLElement {
        if (this._htmlElement) this.removeHtmlElement();

        const el = document.createElement(tagName);
        el.id = `nezp-scrollview-mask-${Date.now()}`;

        // 关键：设置 overflow: hidden 实现裁剪
        el.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            overflow: hidden;
            pointer-events: none;
            z-index: ${this.zIndex};
        `;

        // 与普通 Anchor 使用同一个视口坐标系，避免遮罩和头像错位。
        NezpOverlayRoot.ensureRoot().appendChild(el);

        this._htmlElement = el;

        // ✅ 关键修复：设置 DOM 的位置和尺寸，子级 Anchor 才能正确计算相对位置
        this.adjustElementSize();
        this.updateHtmlElementTransform();

        return el;
    }

    /**
     * 获取遮罩容器元素，供子级 Anchor 挂载
     */
    getMaskContainer(): HTMLElement | null {
        return this._htmlElement;
    }
}
