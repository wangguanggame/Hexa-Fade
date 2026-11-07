export type NezpResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: NezpError };

export type NezpError = {
	code: string;
	message: string;
	raw?: any;
};

export type PlayerId = string;
export type ContextId = string;

export type NezpRuntimeOptions = {
	forceValid?: boolean;
	enableLog?: boolean;
};

export type OverlayRect = {
	width: number;
	height: number;
	zIndex?: number;
};

export type OverlayTextStyle = {
	fontFamily?: string;
	fontSize?: number;
	lineHeight?: number;
	color?: string;
	bold?: boolean;
	italic?: boolean;
	horizontalAlign?: "left" | "center" | "right";
	verticalAlign?: "top" | "center" | "bottom";
};

export type ProfileOverlayLayout = {
	imgLeft: number;
	imgTop: number;
	imgWidth: number;
	imgHeight: number;

	nameLeft: number;
	nameTop: number;
	nameWidth: number;
	nameHeight: number;

	textStyle?: OverlayTextStyle;
};

export type SocialSharePayload = {
	cta?: string;
	text?: string;
	data?: Record<string, any>;
	base64Img?: string;
	xmlPath?: string;
	initialData?: Record<string, any>;
};

export type BotSubscribeResult = {
	canSubscribe: boolean;
};
