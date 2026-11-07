import { DEFAULT_SHARE_IMAGE } from "../../../sdk/DefaultShareImage";
import { NezpResult, PlayerId, ContextId, SocialSharePayload } from "./NezpTypes";
import { NezpRuntime } from "./NezpRuntime";

export class NezpSocial {
	private runtime: NezpRuntime;
	private connectedPlayersCache: Array<{ id: PlayerId }> = [];

	constructor(runtime: NezpRuntime) {
		this.runtime = runtime;
	}

	public async getConnectedPlayersAsync(): Promise<NezpResult<Array<{ id: PlayerId }>>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: true, data: [] };

		try {
			if (this.connectedPlayersCache.length > 0) return { ok: true, data: [...this.connectedPlayersCache] };

			const players: any[] = await fb.player.getConnectedPlayersAsync();
			const list = (players ?? []).map((p) => ({ id: p.getID() as string }));
			this.connectedPlayersCache = list;
			return { ok: true, data: [...list] };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("CONNECTED_PLAYERS_FAILED", "获取 Connected Players 失败", e) };
		}
	}

	public getContextId(): ContextId {
		const fb = this.runtime.fb();
		if (!fb) return "";
		try {
			return fb.context.getID();
		} catch {
			return "";
		}
	}

	public async chooseContextAsync(): Promise<NezpResult<void>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: true, data: undefined };

		try {
			await fb.context.chooseAsync();
			return { ok: true, data: undefined };
		} catch (e: any) {
			if (e?.code === "SAME_CONTEXT") return { ok: true, data: undefined };
			return { ok: false, error: this.runtime.makeError("CHOOSE_CONTEXT_FAILED", "选择 Context 失败", e) };
		}
	}

	public async switchContextAsync(contextId: ContextId): Promise<NezpResult<void>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: true, data: undefined };

		try {
			await fb.context.switchAsync(contextId);
			return { ok: true, data: undefined };
		} catch (e: any) {
			if (e?.code === "SAME_CONTEXT") return { ok: true, data: undefined };
			return { ok: false, error: this.runtime.makeError("SWITCH_CONTEXT_FAILED", "切换 Context 失败", e) };
		}
	}

	public async createContextAsync(playerId: PlayerId): Promise<NezpResult<void>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: true, data: undefined };

		try {
			await fb.context.createAsync(playerId);
			return { ok: true, data: undefined };
		} catch (e: any) {
			if (e?.code === "SAME_CONTEXT") return { ok: true, data: undefined };
			return { ok: false, error: this.runtime.makeError("CREATE_CONTEXT_FAILED", "创建 Context 失败", e) };
		}
	}

	public async updateAsync(payload: SocialSharePayload): Promise<NezpResult<void>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: true, data: undefined };

		try {
			await fb.updateAsync({
				action: "CUSTOM",
				cta: payload.cta ?? "PLAY NOW",
				data: payload.data ?? {},
				image: DEFAULT_SHARE_IMAGE,
				text: payload.text ?? "",
				strategy: "IMMEDIATE",
				template: "",
				notification: "NO_PUSH",
			});
			return { ok: true, data: undefined };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("UPDATE_FAILED", "updateAsync 失败", e) };
		}
	}

	public async inviteAsync(imageBase64: string, message: string, data?: Record<string, any>): Promise<NezpResult<void>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: true, data: undefined };

		try {
			await fb.inviteAsync({ image: DEFAULT_SHARE_IMAGE, text: message, data: data ?? {} });
			return { ok: true, data: undefined };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("INVITE_FAILED", "inviteAsync 失败", e) };
		}
	}

	public async shareAsync(payload: SocialSharePayload): Promise<NezpResult<void>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: true, data: undefined };

		try {
			await fb.shareAsync({
				image: DEFAULT_SHARE_IMAGE,
				text: payload.text ?? "",
				data: payload.data ?? {},
			});
			return { ok: true, data: undefined };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("SHARE_FAILED", "shareAsync 失败", e) };
		}
	}
}
