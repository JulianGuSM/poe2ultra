# poe2ultra

[English](README.md) · **简体中文**

poe2ultra 是一款 Chrome 扩展，用于阅读 [Mobalytics](https://mobalytics.gg/poe-2) 上的《流放之路 2》构筑攻略。它将攻略整理为多个阅读面板，并可把攻略内容翻译成简体中文和繁体中文。

## 功能

- 通过总览、技能、装备、天赋与异界、升级路线等面板浏览攻略。
- 在英语、简体中文和繁体中文之间切换；原文会保留，方便对照阅读。
- 分批翻译攻略并将译文保存在本机缓存中；可续译中断任务，也可单独重译文字块。
- 在支持的富文本攻略内容中保留链接、图标和可点击的实体详情。
- 打开装备交易搜索链接，简体中文支持国服交易站。
- 在设置允许的网站上划词翻译，可使用浮标、`Alt+Q` 或右键菜单。
- 配置翻译服务、提示词、术语表、可选联网查询、诊断日志和费用估算。

## 从 GitHub Releases 安装

从[最新版本](https://github.com/JulianGuSM/poe2ultra/releases/latest)下载 Chrome ZIP 安装包。

手动安装：

1. 解压下载的 ZIP。
2. 打开 `chrome://extensions`，启用右上角的**开发者模式**。
3. 点击**加载未打包的扩展程序**，选择解压后直接包含 `manifest.json` 的文件夹。
4. 打开或刷新 Mobalytics 上的《流放之路 2》攻略页面。

更新时，将新文件覆盖到原扩展目录，然后在扩展卡片上点击**重新加载**。保留原目录和扩展条目可继续使用本地设置与译文缓存。请避免同时启用另一个也会接管同一攻略页面的扩展。

## 配置翻译

1. 点击扩展图标，或使用攻略中的设置入口，打开 poe2ultra 设置页。
2. 填写 API Key 并保存服务设置。默认接口为 DeepSeek；也可配置兼容的自定义接口。
3. 返回攻略，点击翻译进度控件并开始翻译。扩展会分批生成简体和繁体两套译文。
4. 使用语言切换显示或隐藏已缓存译文。切换语言本身不会发送翻译请求。

划词翻译需要先在设置的**划词与面板**中添加允许的网站规则并保存，再刷新对应网页。默认不会因选中文字而自动翻译。

## 隐私

翻译设置保存在浏览器扩展的本地存储中，攻略译文保存在本机 IndexedDB。你主动请求翻译时，poe2ultra 会将相关文本和配置上下文发送到你选择的翻译服务。启用可选术语查询后，查询内容也可能发送到对应服务。配置服务前请阅读完整的[隐私声明](PRIVACY.md)；分享缓存备份或调试日志前，请先检查其中的内容。

## 从源码构建

需要 Node.js 和 npm。

```sh
npm ci
npm run build
```

未打包的 Chrome 扩展生成在 `.output/chrome-mv3`。生成发布包：

```sh
npm run zip:store
```

发布包位于 `.output/releases`。如需从 CSV 源文件重新生成内置术语 JSON，运行 `npm run build:poe2-terms`。

## 更多信息

- [English README](README.md)
- [更新日志](CHANGELOG.md)
- [隐私声明](PRIVACY.md)
- [许可证](LICENSE)
- [上游项目说明](docs/UPSTREAM-README.md)

poe2ultra 基于 [ReSenpai/poe2perfect](https://github.com/ReSenpai/poe2perfect)，并包含翻译组件和术语数据。版权归属和许可证信息见[项目声明](NOTICE)。

## 赞赏支持

如果 poe2ultra 对你有帮助，欢迎扫码赞赏。感谢支持！

![Julian 的赞赏码](docs/images/donation.png)
