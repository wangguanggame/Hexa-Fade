import { NezpRuntimeOptions } from "./NezpTypes";
import { MockOverlayViews } from "../mock/MockOverlayView";

/**
 * NEZP 运行时环境
 * 负责处理 FB SDK 的访问（支持 Mock 模式）和基础日志/错误处理
 */
export class NezpRuntime {
    private options: NezpRuntimeOptions;
    private mockFB: any = null;

    constructor(options: NezpRuntimeOptions = { enableLog: false }) {
        this.options = options;
    }

    /**
     * 获取 FB SDK 实例
     * 在本地构建环境下会自动返回 Mock 版本的 SDK
     */
    public fb(): any {
        const fb = (globalThis as any).FBInstant;
        if (fb) return fb;

        // // ✅ 只有是 FB 平台且没有真实 SDK 时，才允许进入 Mock 模式
        // if (PlatformAdapter.platform !== EPlatform.FB) {
        //     return null;
        // }

        // 如果没有 FBInstant，说明在本地 Mock 环境
        if (!this.mockFB) {
            this.mockFB = this.createMockFB();
            console.log("[NEZP] 使用 Mock OverlayViews (本地测试模式)");
        }
        return this.mockFB;
    }

    /**
     * 创建 Mock 版本的 FBInstant SDK
     */
    private createMockFB(): any {
        return {
            player: {
                getID: () => "12345678901234567",
                getName: () => "Mock Player",
                getPhoto: () => "avatarview.png",
                getConnectedPlayersAsync: async () => [],
            },
            context: {
                getID: () => "mock-context-123",
                getType: () => "SOLO",
                chooseAsync: async () => { },
                switchAsync: async () => { },
                createAsync: async () => { },
            },
            overlayViews: new MockOverlayViews(),
            getLeaderboardAsync: async (name: string) => {
                console.log(`[NEZP Mock] 获取排行榜: ${name}`);
                return {
                    getName: () => name,
                    setScoreAsync: async (score: number, extraData?: string) => {
                        console.log(`[NEZP Mock] ${name} 写分: ${score}`, extraData);
                    },
                    getEntriesAsync: async (count: number, offset: number) => {
                        console.log(`[NEZP Mock] ${name} 拉取榜单, count=${count}`);
                        const mockList = [
                            { id: "12345678901234567", name: "Mock Player (You)", score: 9999, rank: 1 },
                            { id: "mock-id-2", name: "Sniper Master", score: 8888, rank: 2 },
                            { id: "mock-id-3", name: "Quick Shot", score: 7777, rank: 3 },
                            { id: "mock-id-4", name: "Ghost Rider", score: 6666, rank: 4 },
                            { id: "mock-id-5", name: "Elite Guard", score: 5555, rank: 5 },
                        ];
                        return mockList.slice(offset, offset + count).map(it => ({
                            getScore: () => it.score,
                            getRank: () => it.rank,
                            getExtraData: () => "{}",
                            getPlayer: () => ({
                                getID: () => it.id,
                                getName: () => it.name,
                                getPhoto: () => "avatarview.png"
                            })
                        }));
                    }
                };
            },
            getSupportedAPIs: () => [],
            getEntryPointData: () => ({}),
            logEvent: () => { },
            onPause: () => { },
            updateAsync: async () => { },
            shareAsync: async () => { },
            inviteAsync: async () => { },
        };
    }

    public log(msg: string, ...args: any[]) {
        if (this.options.enableLog) {
            console.log(`[NEZP] ${msg}`, ...args);
        }
    }

    public warn(msg: string, ...args: any[]) {
        if (this.options.enableLog) {
            console.warn(`[NEZP] ${msg}`, ...args);
        }
    }

    public error(msg: string, ...args: any[]) {
        if (this.options.enableLog) {
            console.error(`[NEZP] ${msg}`, ...args);
        }
    }

    public makeError(code: string, message: string, extra?: any) {
        return { code, message, extra };
    }
}
