import { NezpResult, PlayerId } from "./NezpTypes";
import { NezpRuntime } from "./NezpRuntime";

export type LeaderboardEntry = {
	playerId: PlayerId;
	score: number;
	rank?: number;
	name?: string;
	avatar?: string;
	data?: any;
};

export interface ILeaderboardProvider {
	setScoreAsync(leaderboardName: string, score: number, extraData?: string): Promise<NezpResult<void>>;
	getEntriesAsync(leaderboardName: string, count: number, offset?: number): Promise<NezpResult<LeaderboardEntry[]>>;
}

export class FbInstantLeaderboardProvider implements ILeaderboardProvider {
	private runtime: NezpRuntime;

	constructor(runtime: NezpRuntime) {
		this.runtime = runtime;
	}

	private async getLbAsync(name: string): Promise<any> {
		const fb = this.runtime.fb();
		if (!fb) throw new Error("FBInstant not available");
		if (!fb.getLeaderboardAsync) throw new Error("FBInstant.getLeaderboardAsync not supported");
		return fb.getLeaderboardAsync(name);
	}

	public async setScoreAsync(leaderboardName: string, score: number, extraData?: string): Promise<NezpResult<void>> {
		try {
			const lb = await this.getLbAsync(leaderboardName);
			await lb.setScoreAsync(score, extraData);
			return { ok: true, data: undefined };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("LB_SET_SCORE_FAILED", "原生榜单 setScoreAsync 失败", e) };
		}
	}

	public async getEntriesAsync(leaderboardName: string, count: number, offset = 0): Promise<NezpResult<LeaderboardEntry[]>> {
		try {
			const lb = await this.getLbAsync(leaderboardName);
			const entries = await lb.getEntriesAsync(count, offset);
			const list: LeaderboardEntry[] = (entries ?? []).map((en: any) => ({
				playerId: en.getPlayer()?.getID?.() ?? "",
				score: en.getScore?.() ?? 0,
				rank: en.getRank?.(),
				data: en.getExtraData?.(),
			}));
			return { ok: true, data: list };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("LB_GET_ENTRIES_FAILED", "原生榜单 getEntriesAsync 失败", e) };
		}
	}
}

export class BackendLeaderboardProvider implements ILeaderboardProvider {
	private runtime: NezpRuntime;
	private baseUrl: string;

	constructor(runtime: NezpRuntime, baseUrl: string) {
		this.runtime = runtime;
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
	}

	private async getHeaders(): Promise<Record<string, string>> {
		return { "Content-Type": "application/json" };
	}

	public async setScoreAsync(leaderboardName: string, score: number, extraData?: string): Promise<NezpResult<void>> {
		try {
			const headers = await this.getHeaders();
			const payload = {
				leaderboardId: leaderboardName,
				playerId: (globalThis as any).FBInstant?.player?.getID?.() ?? "",
				score,
				data: extraData ?? "",
			};
			const res = await fetch(this.baseUrl + "player-score", { method: "POST", headers, body: JSON.stringify(payload) });
			const json = await res.json();
			if (json?.success === false) {
				return { ok: false, error: this.runtime.makeError("BACKEND_LB_SET_SCORE_FAILED", json?.message ?? "后端写分失败", json) };
			}
			return { ok: true, data: undefined };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("BACKEND_LB_SET_SCORE_FAILED", "后端写分失败", e) };
		}
	}

	public async getEntriesAsync(leaderboardName: string, count: number, offset = 0): Promise<NezpResult<LeaderboardEntry[]>> {
		try {
			const headers = await this.getHeaders();
			const url = `${this.baseUrl}${leaderboardName}?limit=${count}&offset=${offset}`;
			const res = await fetch(url, { method: "GET", headers });
			const json = await res.json();
			const data = json?.data ?? json ?? [];
			const list: LeaderboardEntry[] = (data ?? []).map((it: any) => ({
				playerId: it.playerId ?? it.id ?? "",
				score: Number(it.score ?? 0),
				rank: it.rank,
				data: it.data,
			}));
			return { ok: true, data: list };
		} catch (e) {
			return { ok: false, error: this.runtime.makeError("BACKEND_LB_GET_ENTRIES_FAILED", "后端拉榜失败", e) };
		}
	}
}
