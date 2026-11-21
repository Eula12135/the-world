/**
 * 由 vite.config.ts 的 `define` 在构建时注入（值来自 package.json 的 version）。
 * 测试与 electron 侧的配置共用同一份 define，因此不会出现两处版本号不一致。
 */
declare const __APP_VERSION__: string;
