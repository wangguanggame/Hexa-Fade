import { NezpRuntime } from "./NezpRuntime";
import { NezpOverlayViews } from "./NezpOverlayViews";
import { NezpSocial } from "./NezpSocial";
import { NezpNotifications } from "./NezpNotifications";
import { BackendLeaderboardProvider, FbInstantLeaderboardProvider, ILeaderboardProvider } from "./NezpLeaderboards";

export type NezpKitConfig = {
	enableLog?: boolean;
	/** 你 bundle 的全局榜单如果走后端，填 baseUrl */
	leaderboardBackendBaseUrl?: string;
};

export class NezpKit {
	private static _inst: NezpKit | null = null;
	static get inst(): NezpKit {
		if (!this._inst) this._inst = new NezpKit();
		return this._inst;
	}

	runtime!: NezpRuntime;
	overlayViews!: NezpOverlayViews;
	social!: NezpSocial;
	notifications!: NezpNotifications;
	leaderboardProvider!: ILeaderboardProvider;

	private inited = false;

	init(cfg: NezpKitConfig = {}) {
		if (this.inited) return;

		this.runtime = new NezpRuntime({ enableLog: !!cfg.enableLog });
		this.overlayViews = new NezpOverlayViews(this.runtime);
		this.social = new NezpSocial(this.runtime);
		this.notifications = new NezpNotifications(this.runtime);

		// provider 优先：原生 -> 后端（若提供）
		const fbProvider = new FbInstantLeaderboardProvider(this.runtime);
		if (cfg.leaderboardBackendBaseUrl) {
			const backend = new BackendLeaderboardProvider(this.runtime, cfg.leaderboardBackendBaseUrl);
			// 简单策略：先用 fbProvider，如果失败由调用端切换；这里先默认使用 backend（贴近 bundle 后端榜单）
			this.leaderboardProvider = backend;
			// 你也可以改成一个“组合 provider”，此处先按 bundle：主走后端
			void fbProvider; // 避免未使用警告
		} else {
			this.leaderboardProvider = fbProvider;
		}

		this.inited = true;
	}
}
