import { _decorator, Sprite, UITransform, view } from "cc";
import { NezpHtmlElementBase } from "./NezpHtmlElementBase";

const { ccclass } = _decorator;

/**
 * Anchor：将 bundle 的"DOM 跟随节点"能力暴露出来，作为 OverlayView 的 parent。
 */
@ccclass("NezpOverlayAnchor")
export class NezpOverlayAnchor extends NezpHtmlElementBase {
    /** DOM 在 Canvas 上方：有更靠前的 Cocos 弹窗遮罩时隐藏底层 Overlay。 */
    protected updateHtmlElementTransform() {
        super.updateHtmlElementTransform();
        if (this.htmlElement) {
            this.htmlElement.style.visibility = this.isCoveredByModal() ? 'hidden' : '';
        }
    }

    private isCoveredByModal(): boolean {
        // 按 Cocos 兄弟节点绘制顺序检查，弹窗内部自己的 Overlay 不受其背景遮罩影响。
        let branch = this.node;
        while (branch.parent) {
            const siblings = branch.parent.children;
            for (let i = branch.getSiblingIndex() + 1; i < siblings.length; i++) {
                if (this.containsModalMask(siblings[i])) return true;
            }
            branch = branch.parent;
        }
        return false;
    }

    private containsModalMask(node: import('cc').Node): boolean {
        if (!node.isValid || !node.activeInHierarchy) return false;
        // 仅识别项目的弹窗遮罩，ScrollView 的 cc.Mask 不属于模态遮罩。
        if (/^(mask|maskbg|loadingwaiting)$/i.test(node.name)) return true;
        // 转盘等弹窗把遮罩命名为 bg，按全屏黑色背景识别，避免依赖节点名称。
        const sprite = node.getComponent(Sprite);
        const ui = node.getComponent(UITransform);
        if (sprite?.enabled && ui) {
            const color = sprite.color;
            const design = view.getDesignResolutionSize();
            if (color.r === 0 && color.g === 0 && color.b === 0 && color.a > 0
                && ui.width >= design.width && ui.height >= design.height) return true;
        }
        return node.children.some(child => this.containsModalMask(child));
    }

    getOverlayParentElement(): HTMLElement | null {
        return this.htmlElement;
    }

    getOverlaySize(): { width: number; height: number; zIndex: number } {
        const s = this.getElementSize();
        return { width: s.width, height: s.height, zIndex: this.zIndex };
    }
}
