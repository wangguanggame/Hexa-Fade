import { _decorator, Component, view, screen, ResolutionPolicy } from 'cc';
const { ccclass, property, executionOrder } = _decorator;

/**
 * 屏幕自适应分辨率管理器 (ScreenAdapter)
 * 智能判断屏幕宽高比：
 * - 宽屏/iPad/平板 (实际宽高比 >= 设计宽高比)：采用 FIXED_HEIGHT (定高适配)，避免上下内容被裁切
 * - 细长屏/全面屏手机 (实际宽高比 < 设计宽高比)：采用 FIXED_WIDTH (定宽适配)，避免左右核心区域被裁切
 * 支持运行时动态监听屏幕尺寸变化 (旋转屏幕、折叠屏展开、浏览器窗口拉伸等)。
 */
@ccclass('ScreenAdapter')
@executionOrder(-100)
export class ScreenAdapter extends Component {
    @property({ tooltip: '设计分辨率宽度' })
    public designWidth: number = 1080;

    @property({ tooltip: '设计分辨率高度' })
    public designHeight: number = 1920;

    private static _isListening: boolean = false;

    // 默认设计分辨率 (1080 x 1920)
    public static readonly DESIGN_WIDTH: number = 1080;
    public static readonly DESIGN_HEIGHT: number = 1920;

    onLoad() {
        ScreenAdapter.autoAdapter(this.designWidth, this.designHeight);
        ScreenAdapter.initGlobalListener(this.designWidth, this.designHeight);
    }

    /**
     * 自动根据实际屏幕宽高比切换定宽/定高适配策略
     */
    public static autoAdapter(designWidth: number = ScreenAdapter.DESIGN_WIDTH, designHeight: number = ScreenAdapter.DESIGN_HEIGHT) {
        const designRatio = designWidth / designHeight;
        const windowSize = screen.windowSize;

        if (!windowSize || windowSize.height <= 0) return;
        const actualRatio = windowSize.width / windowSize.height;

        if (actualRatio >= designRatio) {
            // 平板/iPad/宽屏：定高，防止上下内容被裁切
            view.setDesignResolutionSize(designWidth, designHeight, ResolutionPolicy.FIXED_HEIGHT);
        } else {
            // 细长全面屏手机：定宽，防止左右内容被裁切
            view.setDesignResolutionSize(designWidth, designHeight, ResolutionPolicy.FIXED_WIDTH);
        }
    }

    /**
     * 开启全局监听（屏幕旋转、PC 窗口缩放、折叠屏展开时自动重新适配）
     */
    public static initGlobalListener(designWidth: number = ScreenAdapter.DESIGN_WIDTH, designHeight: number = ScreenAdapter.DESIGN_HEIGHT) {
        ScreenAdapter.autoAdapter(designWidth, designHeight);

        if (ScreenAdapter._isListening) return;
        ScreenAdapter._isListening = true;

        const onResize = () => {
            ScreenAdapter.autoAdapter(designWidth, designHeight);
        };

        if (screen && typeof screen.on === 'function') {
            screen.on('window-resize', onResize, ScreenAdapter);
        }
        if (view && typeof view.on === 'function') {
            view.on('canvas-resize', onResize, ScreenAdapter);
        }
    }
}
