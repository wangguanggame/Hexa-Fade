import { NezpResult, BotSubscribeResult } from "./NezpTypes";
import { NezpRuntime } from "./NezpRuntime";

export class NezpNotifications {
	private runtime: NezpRuntime;
	private busy = false;

	constructor(runtime: NezpRuntime) {
		this.runtime = runtime;
	}

	public async canSubscribeBotAsync(): Promise<NezpResult<BotSubscribeResult>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: true, data: { canSubscribe: false } };

		try {
			const can = await fb.player.canSubscribeBotAsync();
			return { ok: true, data: { canSubscribe: !!can } };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("CAN_SUBSCRIBE_FAILED", "canSubscribeBotAsync 调用失败", e) };
		}
	}

	public async subscribeBotAsync(): Promise<NezpResult<void>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: true, data: undefined };

		try {
			await fb.player.subscribeBotAsync();
			return { ok: true, data: undefined };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("SUBSCRIBE_FAILED", "subscribeBotAsync 调用失败", e) };
		}
	}

	public async cancelAllNotificationsAsync(): Promise<NezpResult<{ asid: string }>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: false, error: this.runtime.makeError("FB_NOT_AVAILABLE", "FBInstant 不可用") };
		if (this.busy) return { ok: false, error: this.runtime.makeError("BUSY", "正在执行 cancelAllNotificationsAsync") };

		try {
			this.busy = true;
			const asid: string = await fb.player.getASIDAsync();
			await fb.graphApi.requestAsync(`/${asid}/cancel_all_notifications`, "POST");
			return { ok: true, data: { asid } };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("CANCEL_NOTIFICATIONS_FAILED", "取消所有通知失败", e) };
		} finally {
			this.busy = false;
		}
	}
}
