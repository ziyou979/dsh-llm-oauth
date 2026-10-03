window.__ModuleLoader__.load({
	id: "dsh-llm-oauth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		const BASE = "/dsh-llm-oauth";
		function isStatusSnapshot(body) {
			return typeof body === "object" && body !== null && Array.isArray(body.providers);
		}
		async function request(path, init) {
			const response = await fetch(`${BASE}${path}`, {
				credentials: "same-origin",
				...init,
				headers: {
					accept: "application/json",
					...init?.body === void 0 ? {} : { "content-type": "application/json" },
					...init?.headers
				}
			});
			const text = await response.text();
			let body;
			try {
				body = text.length === 0 ? {} : JSON.parse(text);
			} catch {
				throw new Error(text || `HTTP ${String(response.status)}`);
			}
			if (!response.ok) {
				if (isStatusSnapshot(body)) return body;
				const message = typeof body === "object" && body !== null && "error" in body ? String(body.error) : `HTTP ${String(response.status)}`;
				throw new Error(message);
			}
			return body;
		}
		function fetchOauthStatus() {
			return request("/status");
		}
		function enableOauthProvider(provider) {
			return request("/enable", {
				method: "POST",
				body: JSON.stringify({ provider })
			});
		}
		function disableOauthProvider(provider) {
			return request("/disable", {
				method: "POST",
				body: JSON.stringify({ provider })
			});
		}
		function loginOauthProvider(provider) {
			return request("/login", {
				method: "POST",
				body: JSON.stringify({ provider })
			});
		}
		function logoutOauthProvider(provider) {
			return request("/logout", {
				method: "POST",
				body: JSON.stringify({ provider })
			});
		}
		/**
		* Hand a running sign-in the value it waits for (the final redirect URL or
		* authorization code a browser callback could not deliver to this host).
		*/
		function submitOauthCode(provider, code) {
			return request("/code", {
				method: "POST",
				body: JSON.stringify({
					provider,
					code
				})
			});
		}
		//#endregion
		//#region \0dsh-css:E:\ProjectCollection\TSProjects\dsh-llm-oauth\src\client\OauthSection.module.css.mjs
		const css = ".CLya7q_section{flex-direction:column;gap:12px;max-width:720px;padding:4px 0 24px;display:flex}.CLya7q_title{color:var(--dsw-alias-text-primary,inherit);margin:0;font-size:18px;font-weight:600}.CLya7q_intro{color:var(--dsw-alias-text-secondary,#666);margin:0;font-size:13px;line-height:1.5}.CLya7q_meta{color:var(--dsw-alias-text-tertiary,#888);word-break:break-all;margin:0;font-size:12px}.CLya7q_toolbar{flex-wrap:wrap;gap:8px;display:flex}.CLya7q_rows{flex-direction:column;gap:10px;margin:0;padding:0;list-style:none;display:flex}.CLya7q_rowCard{border:1px solid var(--dsw-alias-border-l2,#e5e5e5);background:var(--dsw-alias-bg-elevated,#fff);border-radius:10px;flex-direction:column;gap:10px;padding:12px 14px;display:flex}.CLya7q_rowHead{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.CLya7q_rowIdentity{flex-direction:column;gap:4px;min-width:0;display:flex}.CLya7q_rowName{font-size:14px;font-weight:600}.CLya7q_rowId{color:var(--dsw-alias-text-tertiary,#888);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}.CLya7q_badges{flex-wrap:wrap;gap:6px;display:flex}.CLya7q_badge{border:1px solid #0000;border-radius:999px;align-items:center;padding:2px 8px;font-size:11px;line-height:1.4;display:inline-flex}.CLya7q_badgeOn{color:#15803d;background:#16a34a1f;border-color:#16a34a47}.CLya7q_badgeOff{color:#475569;background:#64748b1f;border-color:#64748b3d}.CLya7q_badgeOk{color:#1d4ed8;background:#2563eb1f;border-color:#2563eb47}.CLya7q_badgeMissing{color:#b91c1c;background:#dc26261a;border-color:#dc26263d}.CLya7q_badgeWarn{color:#b45309;background:#d977061f;border-color:#d9770647}.CLya7q_rowActions{flex-wrap:wrap;gap:8px;display:flex}.CLya7q_button,.CLya7q_secondaryButton,.CLya7q_dangerButton{appearance:none;border:1px solid var(--dsw-alias-border-l2,#d4d4d4);background:var(--dsw-alias-bg-elevated,#fff);color:inherit;cursor:pointer;border-radius:8px;padding:6px 10px;font-size:13px}.CLya7q_button:disabled,.CLya7q_secondaryButton:disabled,.CLya7q_dangerButton:disabled{opacity:.55;cursor:not-allowed}.CLya7q_button{background:var(--dsw-alias-interactive-bg,#111);color:var(--dsw-alias-interactive-fg,#fff);border-color:#0000}.CLya7q_dangerButton{color:#b91c1c;border-color:#dc262659}.CLya7q_notice,.CLya7q_error,.CLya7q_command{white-space:pre-wrap;word-break:break-word;margin:0;font-size:12px;line-height:1.45}.CLya7q_notice{color:var(--dsw-alias-text-secondary,#666)}.CLya7q_error{color:#b91c1c}.CLya7q_command{color:var(--dsw-alias-text-secondary,#555);background:var(--dsw-alias-bg-subtle,#f6f6f6);border-radius:8px;padding:8px 10px}.CLya7q_codeBox{background:#2563eb14;border:1px solid #2563eb47;border-radius:10px;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;display:flex}.CLya7q_codeLabel{color:var(--dsw-alias-text-secondary,#555);font-size:12px}.CLya7q_codeValue{letter-spacing:.06em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:18px;font-weight:700}.CLya7q_codeInput{border:1px solid var(--dsw-alias-border-l2,#d4d4d4);background:var(--dsw-alias-bg-elevated,#fff);min-width:10rem;color:inherit;font:inherit;border-radius:8px;flex:16rem;padding:6px 8px;font-size:13px}.CLya7q_codeInput:disabled{opacity:.55}.CLya7q_buttonLink{background:var(--dsw-alias-interactive-bg,#111);color:var(--dsw-alias-interactive-fg,#fff);border:1px solid #0000;border-radius:8px;align-items:center;padding:6px 12px;font-size:13px;text-decoration:none;display:inline-flex}.CLya7q_buttonLink:hover{opacity:.92}";
		const tagId = "dsh-llm-oauth/OauthSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-llm-oauth";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var OauthSection_module_css_default = {
			"section": "CLya7q_section",
			"badgeMissing": "CLya7q_badgeMissing",
			"rowActions": "CLya7q_rowActions",
			"rowHead": "CLya7q_rowHead",
			"secondaryButton": "CLya7q_secondaryButton",
			"badges": "CLya7q_badges",
			"button": "CLya7q_button",
			"command": "CLya7q_command",
			"rowCard": "CLya7q_rowCard",
			"notice": "CLya7q_notice",
			"error": "CLya7q_error",
			"codeLabel": "CLya7q_codeLabel",
			"badgeOk": "CLya7q_badgeOk",
			"badgeOn": "CLya7q_badgeOn",
			"codeValue": "CLya7q_codeValue",
			"rowId": "CLya7q_rowId",
			"title": "CLya7q_title",
			"dangerButton": "CLya7q_dangerButton",
			"codeBox": "CLya7q_codeBox",
			"buttonLink": "CLya7q_buttonLink",
			"badgeWarn": "CLya7q_badgeWarn",
			"rowName": "CLya7q_rowName",
			"meta": "CLya7q_meta",
			"codeInput": "CLya7q_codeInput",
			"rowIdentity": "CLya7q_rowIdentity",
			"rows": "CLya7q_rows",
			"intro": "CLya7q_intro",
			"badgeOff": "CLya7q_badgeOff",
			"toolbar": "CLya7q_toolbar",
			"badge": "CLya7q_badge"
		};
		//#endregion
		//#region src/client/OauthSection.tsx
		/**
		* Settings → OAuth / 订阅: enable toggles + login status.
		* Talks to the host plugin over `/dsh-llm-oauth/*` (not Typert RPC).
		* On login, opens the authorization URL in a new window when the host returns one.
		*/
		/** Try to open the OAuth URL; returns false if the browser blocked the popup. */
		function tryOpenAuthWindow(url) {
			try {
				return window.open(url, "_blank", "noopener,noreferrer") !== null;
			} catch {
				return false;
			}
		}
		function extractHttpUrl(text) {
			if (text === void 0) return void 0;
			return text.match(/https?:\/\/[^\s]+/i)?.[0];
		}
		function OauthSection(props) {
			const { t } = props;
			if (t === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Loaded, { t });
		}
		function Loaded({ t }) {
			const [status, setStatus] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(void 0);
			const [command, setCommand] = (0, react.useState)(void 0);
			const [popupBlocked, setPopupBlocked] = (0, react.useState)(false);
			const load = (0, react.useCallback)(async () => {
				setBusy({ action: "refresh" });
				setError(void 0);
				try {
					const next = await fetchOauthStatus();
					setStatus(next);
					setCommand(void 0);
					setPopupBlocked(false);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(void 0);
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const applyLoginResult = (next) => {
				setStatus(next);
				const cmd = next.command;
				setCommand(cmd);
				if (cmd?.kind === "error" && cmd.text) setError(cmd.text);
				const url = cmd?.openUrl ?? extractHttpUrl(cmd?.text);
				if (url !== void 0 && cmd?.kind !== "error") {
					const opened = tryOpenAuthWindow(url);
					setPopupBlocked(!opened);
				} else setPopupBlocked(false);
			};
			const run = async (provider, action, fn) => {
				setBusy({
					id: provider,
					action
				});
				setError(void 0);
				if (action !== "login" && action !== "code") {
					setCommand(void 0);
					setPopupBlocked(false);
				}
				try {
					const next = await fn(provider);
					if (action === "login") applyLoginResult(next);
					else {
						setStatus(next);
						setCommand(next.command);
						setError(next.command?.kind === "error" ? next.command.text : void 0);
						if (action !== "code") setPopupBlocked(false);
					}
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(void 0);
				}
			};
			if (status === void 0 && error === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: OauthSection_module_css_default.section,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: OauthSection_module_css_default.title,
					children: t("title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: OauthSection_module_css_default.notice,
					children: t("loading")
				})]
			});
			if (status === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: OauthSection_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: OauthSection_module_css_default.title,
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: OauthSection_module_css_default.error,
						children: `${t("loadFailed")}: ${error ?? ""}`
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: OauthSection_module_css_default.toolbar,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: OauthSection_module_css_default.secondaryButton,
							onClick: () => {
								load();
							},
							children: t("retry")
						})
					})
				]
			});
			const globalBusy = busy?.action === "refresh";
			const authUrl = command?.openUrl ?? extractHttpUrl(command?.text);
			const userCode = command?.userCode;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: OauthSection_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: OauthSection_module_css_default.title,
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: OauthSection_module_css_default.intro,
						children: t("intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: OauthSection_module_css_default.meta,
						children: `${t("authFile")}: ${status.authPath}`
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: OauthSection_module_css_default.toolbar,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: OauthSection_module_css_default.secondaryButton,
							disabled: globalBusy,
							onClick: () => {
								load();
							},
							children: globalBusy ? t("busy") : t("refresh")
						})
					}),
					error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: OauthSection_module_css_default.error,
						children: error
					}) : null,
					popupBlocked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: OauthSection_module_css_default.error,
						children: t("popupBlocked")
					}) : null,
					userCode !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: OauthSection_module_css_default.codeBox,
						role: "status",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: OauthSection_module_css_default.codeLabel,
								children: t("userCodeLabel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								className: OauthSection_module_css_default.codeValue,
								children: userCode
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: OauthSection_module_css_default.secondaryButton,
								onClick: () => {
									navigator.clipboard?.writeText(userCode);
								},
								children: t("copyCode")
							})
						]
					}) : null,
					authUrl !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: OauthSection_module_css_default.toolbar,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							className: OauthSection_module_css_default.buttonLink,
							href: authUrl,
							target: "_blank",
							rel: "noopener noreferrer",
							onClick: () => {
								setPopupBlocked(false);
							},
							children: t("openAuth")
						})
					}) : null,
					command?.text !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: OauthSection_module_css_default.command,
						role: "status",
						children: command.text
					}) : null,
					status.providers.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: OauthSection_module_css_default.notice,
						children: t("empty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: OauthSection_module_css_default.rows,
						children: status.providers.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderRow, {
							row,
							t,
							busy,
							onEnable: () => {
								run(row.id, "enable", enableOauthProvider);
							},
							onDisable: () => {
								run(row.id, "disable", disableOauthProvider);
							},
							onLogin: () => {
								run(row.id, "login", loginOauthProvider);
							},
							onLogout: () => {
								run(row.id, "logout", logoutOauthProvider);
							},
							onSubmitCode: (code) => {
								run(row.id, "code", (id) => submitOauthCode(id, code));
							}
						}, row.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: OauthSection_module_css_default.notice,
						children: t("tipEnable")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: OauthSection_module_css_default.notice,
						children: t("tipLogin")
					})
				]
			});
		}
		function ProviderRow(props) {
			const { row, t, busy, onEnable, onDisable, onLogin, onLogout, onSubmitCode } = props;
			const rowBusy = busy?.id === row.id;
			const disabled = busy !== void 0;
			const [code, setCode] = (0, react.useState)("");
			const submit = () => {
				const value = code.trim();
				if (value.length === 0) return;
				setCode("");
				onSubmitCode(value);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: OauthSection_module_css_default.rowCard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: OauthSection_module_css_default.rowHead,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: OauthSection_module_css_default.rowIdentity,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: OauthSection_module_css_default.rowName,
									children: row.name
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: OauthSection_module_css_default.rowId,
									children: row.id
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: OauthSection_module_css_default.badges,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `${OauthSection_module_css_default.badge} ${row.enabled ? OauthSection_module_css_default.badgeOn : OauthSection_module_css_default.badgeOff}`,
											children: row.enabled ? t("enabled") : t("disabled")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `${OauthSection_module_css_default.badge} ${row.loggedIn ? OauthSection_module_css_default.badgeOk : OauthSection_module_css_default.badgeMissing}`,
											children: row.loggedIn ? `${t("loggedIn")}${row.authType ? ` (${row.authType})` : ""}` : t("loggedOut")
										}),
										row.loginStatus === "waiting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `${OauthSection_module_css_default.badge} ${OauthSection_module_css_default.badgeWarn}`,
											children: t("loginWaiting")
										}) : null,
										row.loginStatus === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `${OauthSection_module_css_default.badge} ${OauthSection_module_css_default.badgeMissing}`,
											children: t("loginError")
										}) : null
									]
								}),
								row.id === "openrouter" && !row.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: OauthSection_module_css_default.notice,
									children: t("openrouterWarn")
								}) : null,
								row.id === "openai" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: OauthSection_module_css_default.notice,
									children: t("openaiWarn")
								}) : null,
								row.loginDetail !== void 0 && row.loginStatus === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: OauthSection_module_css_default.error,
									children: row.loginDetail
								}) : null
							]
						})
					}),
					row.loginPrompt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: OauthSection_module_css_default.codeBox,
						onSubmit: (event) => {
							event.preventDefault();
							submit();
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: OauthSection_module_css_default.codeLabel,
								children: row.loginPrompt.message
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: OauthSection_module_css_default.codeInput,
								type: "text",
								value: code,
								disabled,
								placeholder: row.loginPrompt.placeholder ?? t("pastePlaceholder"),
								onChange: (event) => {
									setCode(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								className: OauthSection_module_css_default.secondaryButton,
								disabled: disabled || code.trim().length === 0,
								children: rowBusy && busy?.action === "code" ? t("busy") : t("submitCode")
							})
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: OauthSection_module_css_default.rowActions,
						children: [row.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: OauthSection_module_css_default.secondaryButton,
							disabled,
							onClick: onDisable,
							children: rowBusy && busy?.action === "disable" ? t("busy") : t("disable")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: OauthSection_module_css_default.button,
							disabled,
							onClick: onEnable,
							children: rowBusy && busy?.action === "enable" ? t("busy") : t("enable")
						}), row.loggedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: OauthSection_module_css_default.dangerButton,
							disabled,
							onClick: onLogout,
							children: rowBusy && busy?.action === "logout" ? t("busy") : t("logout")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: OauthSection_module_css_default.secondaryButton,
							disabled,
							onClick: onLogin,
							children: rowBusy && busy?.action === "login" ? t("busy") : t("login")
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** OAuth settings section copy (standalone Settings nav entry). */
		const zh = {
			nav: "OAuth / 订阅",
			title: "OAuth / 订阅套餐",
			intro: "在此开启订阅提供方、登录或退出。只有「已开启」的提供方会出现在模型选择器；API Key 仍在设置 → 模型。也可在聊天中使用 /oauth 管理订阅提供方。",
			authFile: "凭据文件",
			refresh: "刷新状态",
			loading: "加载中…",
			loadFailed: "无法加载 OAuth 状态",
			retry: "重试",
			empty: "当前 catalog 为空。",
			enabled: "已开启",
			disabled: "未开启",
			loggedIn: "已登录",
			loggedOut: "未登录",
			loginWaiting: "浏览器登录进行中…",
			loginError: "最近一次登录失败",
			enable: "开启",
			disable: "关闭",
			login: "登录",
			logout: "退出登录",
			busy: "处理中…",
			tipEnable: "开启后，该提供方会出现在模型选择器（需已登录才能对话）。",
			tipLogin: "登录会写入订阅 token，并自动开启该提供方。浏览器会尽量自动打开授权页；若被拦截请点下方链接。",
			openAuth: "打开授权页",
			userCodeLabel: "设备码",
			copyCode: "复制设备码",
			submitCode: "提交",
			pastePlaceholder: "粘贴浏览器最终地址或授权码",
			popupBlocked: "浏览器拦截了弹窗，请点「打开授权页」或允许本站弹窗后重试登录。",
			openrouterWarn: "OpenRouter catalog 很大；确认需要后再开启。",
			openaiWarn: "openai 走「Sign in with ChatGPT」。若已在设置 → 模型用 API Key 配过 openai，请先移除该配置：同一个路由只能由一个提供方注册。"
		};
		const en = {
			nav: "OAuth / Subscriptions",
			title: "OAuth / subscription plans",
			intro: "Enable subscription providers and sign in or out here. Only enabled providers appear in the model picker; API keys stay under Settings → Models. You can also manage subscription providers with /oauth in chat.",
			authFile: "Credential file",
			refresh: "Refresh",
			loading: "Loading…",
			loadFailed: "Could not load OAuth status",
			retry: "Retry",
			empty: "Catalog is empty.",
			enabled: "Enabled",
			disabled: "Disabled",
			loggedIn: "Signed in",
			loggedOut: "Not signed in",
			loginWaiting: "Browser login in progress…",
			loginError: "Last login failed",
			enable: "Enable",
			disable: "Disable",
			login: "Sign in",
			logout: "Sign out",
			busy: "Working…",
			tipEnable: "When enabled, this provider appears in the model picker (sign-in still required to chat).",
			tipLogin: "Sign-in stores the subscription token and auto-enables the provider. The auth page opens automatically when possible; use the link if a popup was blocked.",
			openAuth: "Open authorization page",
			userCodeLabel: "Device code",
			copyCode: "Copy code",
			submitCode: "Submit",
			pastePlaceholder: "Paste the final redirect URL or code",
			popupBlocked: "The browser blocked the popup. Click “Open authorization page” or allow popups for this site and try again.",
			openrouterWarn: "OpenRouter’s catalog is large; enable only if you need it.",
			openaiWarn: "openai signs in with ChatGPT. If Settings → Models already configures an openai API key, remove that profile first — one route id can be registered by only one provider."
		};
		//#endregion
		//#region src/client/index.ts
		const NS = "settings.oauth";
		/** Required client services. */
		const inject = ["slots", "locale"];
		/**
		* Register a standalone OAuth settings section next to Models / Plugins.
		* @param ctx - browser Cordis context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-llm-oauth: dictionaries");
			const t = ctx.locale.bind(NS);
			const injected = () => ({ t });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "oauth",
				order: 12,
				label: () => t("nav"),
				inject: injected
			}, OauthSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map