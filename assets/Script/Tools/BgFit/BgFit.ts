import { _decorator, Component, Node, Sprite, view, UITransform, screen } from "cc";
const { ccclass, property, executeInEditMode } = _decorator;

@ccclass('BgFit')
@executeInEditMode(true)
export class BgFit extends Component {
    @property({ tooltip: '是否保持等比缩放并全屏铺满（Aspect Fill，不变形、无黑边）' })
    public aspectFill: boolean = true;

    onLoad() {
        this.bgFitScreen();
    }

    start() {
        this.bgFitScreen();
    }

    onEnable() {
        this.bgFitScreen();
        // 监听运行时窗口/屏幕尺寸改变事件，动态调整适配
        if (view && typeof view.on === 'function') {
            view.on('canvas-resize', this.bgFitScreen, this);
        }
        if (screen && typeof screen.on === 'function') {
            screen.on('window-resize', this.bgFitScreen, this);
        }
    }

    onDisable() {
        if (view && typeof view.off === 'function') {
            view.off('canvas-resize', this.bgFitScreen, this);
        }
        if (screen && typeof screen.off === 'function') {
            screen.off('window-resize', this.bgFitScreen, this);
        }
    }

    /**
     * 背景图全屏适配
     */
    public bgFitScreen(bgNode?: Node) {
        const targetNode = bgNode || this.node;
        if (!targetNode || !targetNode.isValid) return;

        // 1. 获取目标屏幕/设计分辨率尺寸
        let screenWidth = 0;
        let screenHeight = 0;

        // 运行时优先获取当前可视区域尺寸
        if (view && typeof view.getVisibleSize === 'function') {
            const visibleSize = view.getVisibleSize();
            if (visibleSize && visibleSize.width > 0 && visibleSize.height > 0) {
                screenWidth = visibleSize.width;
                screenHeight = visibleSize.height;
            }
        }

        // 编辑器模式下（或 visibleSize 为空时），从父节点 UITransform 或设计分辨率获取
        if (screenWidth <= 0 || screenHeight <= 0) {
            const parentTrans = targetNode.parent ? targetNode.parent.getComponent(UITransform) : null;
            if (parentTrans && parentTrans.width > 0 && parentTrans.height > 0) {
                screenWidth = parentTrans.width;
                screenHeight = parentTrans.height;
            } else if (view && typeof view.getDesignResolutionSize === 'function') {
                const designSize = view.getDesignResolutionSize();
                screenWidth = designSize.width || 1080;
                screenHeight = designSize.height || 1920;
            } else {
                screenWidth = 1080;
                screenHeight = 1920;
            }
        }

        // 2. 获取背景图原始像素尺寸
        const sprite = targetNode.getComponent(Sprite);
        let originalWidth = 0;
        let originalHeight = 0;

        if (sprite && sprite.spriteFrame) {
            const sf = sprite.spriteFrame;
            if (sf.originalSize && sf.originalSize.width > 0 && sf.originalSize.height > 0) {
                originalWidth = sf.originalSize.width;
                originalHeight = sf.originalSize.height;
            } else if (sf.rect && sf.rect.width > 0 && sf.rect.height > 0) {
                originalWidth = sf.rect.width;
                originalHeight = sf.rect.height;
            }
        }

        // 若无法从 SpriteFrame 读取，则从 UITransform 取尺寸
        if (originalWidth <= 0 || originalHeight <= 0) {
            const trans = targetNode.getComponent(UITransform);
            if (trans && trans.width > 0 && trans.height > 0) {
                originalWidth = trans.width;
                originalHeight = trans.height;
            } else {
                originalWidth = 539;
                originalHeight = 960;
            }
        }

        // 3. 计算缩放比例
        const widthScale = screenWidth / originalWidth;
        const heightScale = screenHeight / originalHeight;

        // 等比全屏铺满（取较大值，确保完全覆盖屏幕无黑边）
        const scale = this.aspectFill ? Math.max(heightScale, widthScale) : Math.min(heightScale, widthScale);

        // 应用缩放和居中
        targetNode.setScale(scale, scale, 1);
        targetNode.setPosition(0, 0, 0);
    }
}