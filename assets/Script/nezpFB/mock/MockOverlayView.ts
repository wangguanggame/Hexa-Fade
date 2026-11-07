import { assetManager, ImageAsset } from 'cc';

const previewFrameAssets: Record<string, string> = {
    'frame/Avatar_Frame_Bg.png': 'd6c483f2-bd91-4427-b0d2-1fd7af5fe086',
    'frame/Top1_Bg.png': '984f0204-42bf-4d8e-a059-b8f1b7800932',
    'frame/Top2_Bg.png': '92924b73-5252-4120-b0c2-59b2ecf15f31',
    'frame/Top3_Bg.png': 'f554d219-6e4d-44c8-8e94-ed524c740c46',
};

/**
 * Mock OverlayView - 本地测试用
 * 在非 FB 环境下模拟 OverlayView 的显示效果
 * 
 * 设计思路：
 * - 使用普通 div + absolute 定位
 * - 尺寸和位置都使用 iframeStyle 中指定的值
 * - 不使用 iframe，避免加载问题
 */
export class MockOverlayView {
    private element: HTMLDivElement | null = null;
    private id: string;

    constructor(
        private xml: string,
        private parent: HTMLElement,
        private iframeStyle: string,
        private cssFile: string | undefined,
        private initData: any
    ) {
        this.id = "mock-overlay-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);
        this.createMockElement();
    }

    private createMockElement() {
        this.element = document.createElement("div");
        this.element.id = this.id;

        // 1. 设置外层容器样式
        this.element.style.cssText = this.iframeStyle;
        this.element.style.display = "block"; // 改为 block 容器
        this.element.style.boxSizing = "border-box";
        this.element.style.overflow = "visible"; // 允许内容溢出

        // 2. 转换 XML 为 HTML
        // FB 标签映射：View -> div, Image -> img/div, Text -> span/div
        let html = this.xml
            .replace(/<View/g, "<div")
            .replace(/<\/View>/g, "</div>");

        // 处理 Text 标签 (处理自闭合形式)
        // <Text content="AAA" style="BBB" /> -> <div style="BBB">AAA</div>
        html = html.replace(/<Text([^>]+)\/>/g, (match, attrs) => {
            const contentMatch = attrs.match(/content="([^"]*)"/); // 注意可能为空字符串
            const styleMatch = attrs.match(/style="([^"]+)"/);
            let content = contentMatch ? contentMatch[1] : "";
            const style = styleMatch ? styleMatch[1] : "";

            if (content.includes("FBInstant")) content = "Player Name";
            return `<div style="${style}">${content}</div>`;
        });

        // 处理 Image 标签
        html = html.replace(/<Image([^>]+)\/>/g, (match, attrs) => {
            const srcMatch = attrs.match(/src="([^"]+)"/);
            const styleMatch = attrs.match(/style="([^"]+)"/);
            let src = srcMatch ? srcMatch[1] : "";
            const style = styleMatch ? styleMatch[1] : "";

            if (src.includes("FBInstant")) {
                return `<div style="${style}; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display:flex; align-items:center; justify-content:center; color:white; font-size:10px; overflow:hidden;">👤</div>`;
            }
            // ✅ 为边框图片路径添加 frame/ 前缀
            if (src && !src.startsWith("frame/") && !src.startsWith("http")) {
                src = "frame/" + src;
            }
            // Creator 预览不提供 build-templates 下的静态 frame/ 目录。
            // 先不设置 src，避免 404，再使用资源数据库的原图 URL。
            if (previewFrameAssets[src]) {
                return `<img data-preview-frame="${src}" style="${style}" />`;
            }
            return `<img src="${src}" style="${style}" />`;
        });

        this.element.innerHTML = html;

        this.element.querySelectorAll<HTMLImageElement>('img[data-preview-frame]').forEach(img => {
            const uuid = previewFrameAssets[img.dataset.previewFrame || ''];
            assetManager.loadAny<ImageAsset>(uuid, (err, image) => {
                if (!this.element || !this.element.contains(img)) return;
                if (err || !image?.nativeUrl) {
                    img.style.display = 'none';
                    console.warn('[MockOverlay] 预览装饰图片加载失败', uuid, err);
                    return;
                }
                img.src = image.nativeUrl;
            });
        });

        // 3. Mock 标识（左下角）
        const mockLabel = document.createElement("div");
        mockLabel.style.cssText = `
            position: absolute;
            bottom: 2px;
            right: 2px;
            font-size: 8px;
            color: #ff6600;
            background: rgba(0,0,0,0.8);
            padding: 0 3px;
            border-radius: 2px;
            pointer-events: none;
            z-index: 999999;
            font-family: sans-serif;
            line-height:1;
        `;
        mockLabel.textContent = "MOCK";
        this.element.appendChild(mockLabel);

        console.log("[MockOverlay] 准备添加到 parent:", {
            parentId: this.parent.id,
            elementId: this.element.id,
            xmlSnippet: this.xml.substring(0, 100) + "..."
        });

        this.parent.appendChild(this.element);

        // 调试用：如果内容是空的或者没显示，打印 HTML
        if (this.element.children.length <= 1) { // 只有 mockLabel
            console.warn("[MockOverlay] 渲染内容可能为空，原始 XML:", this.xml);
        }
    }

    getID(): string {
        return this.id;
    }

    getIFrameElement(): HTMLElement | null {
        return this.element;
    }

    async showAsync(): Promise<void> {
        if (this.element) {
            this.element.style.display = "flex";
        }
    }

    async dismissAsync(): Promise<void> {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
    }

    async updateAsync(data: any): Promise<void> {
    }
}

/**
 * Mock FBInstant.overlayViews - 本地测试用
 */
export class MockOverlayViews {
    private views: Map<string, MockOverlayView> = new Map();

    async createOverlayViewWithXMLStringAsync(
        xml: string,
        parent: HTMLElement,
        iframeStyle: string,
        cssFile?: string,
        initData?: any
    ): Promise<MockOverlayView> {
        console.log("[MockOverlay] 创建 Mock OverlayView", { iframeStyle });
        const view = new MockOverlayView(xml, parent, iframeStyle, cssFile, initData);
        this.views.set(view.getID(), view);
        return view;
    }

    async createProfilePictureOverlayViewAsync(
        parent: HTMLElement,
        playerId: string,
        iframeStyle: string
    ): Promise<MockOverlayView> {
        const xml = `<Image src="{{FBInstant.players[${playerId}].photo}}" />`;
        return this.createOverlayViewWithXMLStringAsync(xml, parent, iframeStyle);
    }

    async createProfileNameOverlayViewAsync(
        parent: HTMLElement,
        playerId: string,
        iframeStyle: string
    ): Promise<MockOverlayView> {
        const xml = `<Text content="{{FBInstant.players[${playerId}].name}}" />`;
        return this.createOverlayViewWithXMLStringAsync(xml, parent, iframeStyle);
    }

    getOverlayViews(): Map<string, MockOverlayView> {
        return this.views;
    }

    setCustomEventHandler(handler: (eventType: string, overlayId: string) => void): void {
    }
}
