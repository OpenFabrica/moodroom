# Moodroom

一个可以“走进去”的情绪板：3D 剖开的小公寓，拖材质上墙/地/软装，摆家具，拖太阳，实时读出 Cozy / Bright / Moody。

- 技术栈：Vite + three.js（无框架），纯前端，所有贴图程序生成，无外部素材。
- 启动：`npm install && npm run dev`；构建：`npm run build`。
- 模块：`src/main.js`（渲染、交互、界面）、`room.js`（房间结构）、`furniture.js`（家具）、`materials.js`（程序材质）、`lighting.js`（日光）、`mood.js`（情绪计算）、`state.js`（槽位、预设、撤销、分享链接）。
- 几何体 UV 以米为单位（`uv.js` 的 `boxUV`），换材质的网格必须过一遍它。
- 开发模式下 `window.__moodroom` 暴露内部对象，便于浏览器自动化测试。
- 版本号与发版规则：@docs/release.md
